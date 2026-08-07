#!/usr/bin/env node
/**
 * An MCP server for writing ABAP Open SQL that SAP's ADT data-preview console
 * will actually accept.
 *
 * It connects to nothing. There is no SAP system behind it, no credential, no
 * network call: every tool is a pure function over a statement you pass in.
 * That is deliberate. Agents lose whole sessions to this dialect, and the
 * console's error messages name the symptom rather than the fix, so the useful
 * thing to hand an agent is the correction, not another connection.
 *
 * Pair it with whichever ADT client you already use.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { normalize, lint, prepare, MAX_STATEMENT_CHARS, AbapSqlError } from "abap-sql";
import { z } from "zod";

const server = new McpServer({ name: "sap-abap-sql", version: "0.1.0" });

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

server.registerTool(
  "abap_sql_prepare",
  {
    title: "Prepare an ABAP Open SQL statement",
    description:
      "Check a SELECT against the ADT data-preview console's dialect and return the statement to send. " +
      "Fixes what is mechanical (spacing inside parentheses, which the parser requires for aggregates, " +
      "DISTINCT, subqueries and boolean groups) and refuses what is not, naming the correction. " +
      "Also enforces the console's 255-character ceiling, measured after normalization. " +
      "Call this before sending any statement to a tenant.",
    inputSchema: { sql: z.string().describe("A single ABAP Open SQL SELECT statement.") },
    annotations: READ_ONLY,
  },
  async ({ sql }) => {
    try {
      const statement = prepare(sql);
      return json({
        ok: true,
        statement,
        length: statement.length,
        limit: MAX_STATEMENT_CHARS,
        changed: statement !== sql.trim(),
      });
    } catch (err) {
      const e = err as AbapSqlError;
      return json({ ok: false, rule: e.rule ?? "unknown", fix: e.message });
    }
  },
);

server.registerTool(
  "abap_sql_check",
  {
    title: "Explain what is wrong with an ABAP Open SQL statement",
    description:
      "Report every dialect problem in a statement without rewriting it, each with a stable rule id and " +
      "the correction. Use when you want to understand a console error rather than just get past it. " +
      "Returns the normalized form alongside, so you can see what would be sent.",
    inputSchema: { sql: z.string().describe("A single ABAP Open SQL SELECT statement.") },
    annotations: READ_ONLY,
  },
  async ({ sql }) => {
    const problems = lint(sql);
    const normalized = normalize(sql);
    return json({
      problems: problems.map((p) => ({ rule: p.rule, fix: p.message, at: p.at })),
      normalized,
      length: normalized.length,
      limit: MAX_STATEMENT_CHARS,
      overLimit: normalized.length > MAX_STATEMENT_CHARS,
    });
  },
);

server.registerTool(
  "abap_sql_rules",
  {
    title: "List the dialect rules",
    description:
      "The ways ABAP Open SQL on the ADT data-preview console differs from standard SQL, each with the " +
      "correct form. Read this once before writing statements rather than discovering them one error at a time.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => json({ limit: MAX_STATEMENT_CHARS, rules: RULES }),
);

const RULES = [
  {
    rule: "paren-spacing",
    wrong: "SUM(netwr), COUNT(DISTINCT kunnr), (a OR b)",
    right: "SUM( netwr ), COUNT( DISTINCT kunnr ), ( a OR b )",
    why: "The parser requires a space on the inside of every parenthesis. COUNT(*) is the one exception.",
  },
  {
    rule: "no-limit",
    wrong: "SELECT a FROM t LIMIT 10",
    right: "Cap the result with your reader's row limit.",
    why: "ABAP Open SQL has no LIMIT clause.",
  },
  {
    rule: "sort-keyword",
    wrong: "ORDER BY a DESC",
    right: "ORDER BY a DESCENDING",
    why: "DESC and ASC are not the ABAP spellings.",
  },
  {
    rule: "field-separator",
    wrong: "p.vbeln",
    right: "p~vbeln",
    why: "Fields are qualified with a tilde. A dot ends the statement.",
  },
  {
    rule: "too-long",
    wrong: "a statement over 255 characters",
    right: "Fewer columns, no ORDER BY, short aliases, or aggregate with GROUP BY.",
    why: "The console accepts 255 characters and rejects 256, measured with whitespace collapsed. Wrapping across lines does not help.",
  },
];

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

await server.connect(new StdioServerTransport());
