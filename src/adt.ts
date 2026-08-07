/**
 * A minimal client for SAP's ADT data-preview console.
 *
 * Scope is deliberately one endpoint: run a SELECT, get rows back. No object
 * browsing, no ABAP execution, no writes. The console is read-only by
 * construction and this stays inside that.
 *
 * Credentials are read from the environment and used to talk directly to the
 * customer's system. Nothing is proxied and nothing is stored: this runs on
 * the machine that already has access.
 */

const SQL_PATH = "/sap/bc/adt/datapreview/freestyle";
const CSRF_PATH = "/sap/bc/adt/compatibility/graph";

/** The console's own ceiling. Raising the request does not raise the cap. */
export const MAX_ROWS = 5000;

export interface AdtConfig {
  url: string;
  user: string;
  password: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
  /** True when rowCount equals the requested cap, so rows are probably missing. */
  truncated: boolean;
  /** Present when the result cannot be taken at face value. */
  warning?: string;
  durationMs: number;
}

/** Reads config from the environment, or explains what is missing. */
export function configFromEnv(env: Record<string, string | undefined>): AdtConfig | null {
  const url = env.SAP_URL?.replace(/\/+$/, "");
  const user = env.SAP_USER;
  const password = env.SAP_PASSWORD;
  return url && user && password ? { url, user, password } : null;
}

export async function query(config: AdtConfig, sql: string, maxRows: number): Promise<QueryResult> {
  const rows = Math.max(1, Math.min(maxRows, MAX_ROWS));
  const startedAt = Date.now();
  const session = await openSession(config);

  const res = await fetch(`${config.url}${SQL_PATH}?rowNumber=${rows}`, {
    method: "POST",
    headers: {
      ...session.headers,
      "Content-Type": "text/plain; charset=utf-8",
      Accept: "application/xml, application/vnd.sap.adt.datapreview.table.v1+xml",
    },
    body: sql,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`SAP returned ${res.status}: ${firstMessage(text) || text.slice(0, 300)}`);

  const parsed = parseDataPreview(text);
  const truncated = parsed.rows.length === rows;
  return {
    ...parsed,
    rowCount: parsed.rows.length,
    truncated,
    warning: warnAbout(parsed, truncated, rows),
    durationMs: Date.now() - startedAt,
  };
}

// ── session ──────────────────────────────────────────────────────────

/**
 * The console needs a CSRF token and the cookies issued alongside it. Any
 * cheap GET will mint both; this uses a compatibility endpoint that exists on
 * every system and returns almost nothing.
 */
async function openSession(config: AdtConfig): Promise<{ headers: Record<string, string> }> {
  const auth = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
  const res = await fetch(`${config.url}${CSRF_PATH}`, {
    headers: { Authorization: auth, "x-csrf-token": "fetch" },
  });

  if (res.status === 401) {
    throw new Error(
      "SAP rejected the credentials (401). A dialog user is forced to change its password, " +
        "which surfaces here as an inexplicable 401. The account needs to be type System.",
    );
  }
  const token = res.headers.get("x-csrf-token");
  if (!token) {
    throw new Error(
      `No CSRF token from ${config.url} (HTTP ${res.status}). ` +
        "Usually means /sap/bc/adt is not active in SICF, or a proxy is enforcing SSO on the path.",
    );
  }

  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  return { headers: { Authorization: auth, "x-csrf-token": token, ...(cookie ? { Cookie: cookie } : {}) } };
}

// ── parsing ──────────────────────────────────────────────────────────

/**
 * The response is COLUMN-oriented: one block per column, each carrying its
 * name followed by every value for that column. Rows are the transpose.
 *
 * An empty value arrives as a self-closing `<dataPreview:data/>` rather than
 * an empty pair. Matching only the paired form drops it, and because each
 * column is transposed independently by position, every later value in that
 * column shifts up a row. The result is a well-formed table with values
 * silently attached to the wrong records, which no aggregate would reveal.
 * Both forms are matched here, and ragged columns raise rather than stitch.
 */
export function parseDataPreview(xml: string): { columns: string[]; rows: Record<string, string>[] } {
  const blocks = xml.match(/<dataPreview:columns>[\s\S]*?<\/dataPreview:columns>/g) ?? [];
  const columns: string[] = [];
  const values: string[][] = [];

  for (const block of blocks) {
    const name = block.match(/dataPreview:name="([^"]*)"/)?.[1];
    if (!name) continue;
    columns.push(name);
    values.push(
      [...block.matchAll(/<dataPreview:data\s*\/>|<dataPreview:data>([\s\S]*?)<\/dataPreview:data>/g)]
        .map((m) => decodeXml(m[1] ?? "")),
    );
  }

  if (columns.length === 0) return { columns: [], rows: [] };

  const heights = new Set(values.map((v) => v.length));
  if (heights.size > 1) {
    throw new Error(
      `Columns disagree on row count (${[...heights].join(", ")}). Refusing to stitch a table ` +
        "whose values would land on the wrong rows.",
    );
  }

  const rows = Array.from({ length: values[0].length }, (_, i) =>
    Object.fromEntries(columns.map((c, j) => [c, values[j][i]])),
  );
  return { columns, rows };
}

function warnAbout(
  parsed: { rows: unknown[] },
  truncated: boolean,
  requested: number,
): string | undefined {
  if (!truncated) return undefined;
  return (
    `ROW CAP HIT: exactly ${requested} rows came back, so this result is TRUNCATED and any total ` +
    `computed from it is understated. Aggregate in the statement with GROUP BY, narrow the WHERE ` +
    `clause, or page through the key range. Raising the cap only moves it (hard limit ${MAX_ROWS}).`
  );
}

function firstMessage(xml: string): string {
  return decodeXml(xml.match(/<message[^>]*>([\s\S]*?)<\/message>/)?.[1] ?? "").trim();
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}
