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
 * The dialect rules also ride in the server's `instructions`, which every
 * client receives on initialize. A tool only helps an agent that thinks to
 * call it, and the agent least likely to think of it is the one about to make
 * the mistake.
 *
 * Pair it with whichever ADT client you already use.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { normalize, lint, prepare, MAX_STATEMENT_CHARS, AbapSqlError } from "abap-sql";
import { z } from "zod";

const INSTRUCTIONS = `ABAP Open SQL on SAP's ADT data-preview console differs from standard SQL in
five ways. Knowing them up front avoids most of the errors:

1. Every parenthesis needs a space on the inside: SUM( netwr ), COUNT( DISTINCT kunnr ),
   IN ( SELECT ... ), ( a OR b ). COUNT(*) is the one exception. Three different-looking
   grammar errors all come from this one rule.
2. There is no LIMIT. Cap results with your reader's row limit instead.
3. Sorting is ORDER BY x DESCENDING / ASCENDING, never DESC / ASC.
4. Join fields are qualified with a tilde: p~vbeln, not p.vbeln. A dot ends the statement.
5. A statement is capped at ${MAX_STATEMENT_CHARS} characters with whitespace collapsed.
   Wrapping across lines does not help. Anything real has to be split and joined client-side.

Call abap_sql_prepare on any SELECT before sending it.`;

const server = new McpServer(
  { name: "sap-abap-sql", version: "0.2.0" },
  { instructions: INSTRUCTIONS },
);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const SQL_INPUT = { sql: z.string().describe("A single ABAP Open SQL SELECT statement.") };

server.registerTool(
  "abap_sql_prepare",
  {
    title: "Prepare a statement before sending it",
    description:
      "Call this before sending any SELECT to an SAP ADT data-preview console. " +
      "Returns the statement to send, or refuses it and names what to change. " +
      "Fixes the mechanical problems itself and enforces the console's 255-character ceiling.",
    inputSchema: SQL_INPUT,
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
  "abap_sql_explain",
  {
    title: "Decode a statement the console rejected",
    description:
      "The console rejected a statement and its error does not say why. Reports every dialect " +
      "problem with the correction and a stable rule id, without rewriting anything. " +
      "Use abap_sql_prepare instead when you just want a statement that works.",
    inputSchema: SQL_INPUT,
    annotations: READ_ONLY,
  },
  async ({ sql }) => {
    const normalized = normalize(sql);
    return json({
      problems: lint(sql).map((p) => ({ rule: p.rule, fix: p.message, at: p.at })),
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
      "The five ways this dialect differs from standard SQL, each with the correct form. " +
      "Also delivered in the server instructions, so you likely have them already.",
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
    why: "The console accepts 255 characters and rejects 256, whitespace collapsed. Wrapping does not help.",
  },
];

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

await server.connect(new StdioServerTransport());
