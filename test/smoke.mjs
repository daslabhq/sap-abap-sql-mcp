/**
 * Start the built server and talk to it over MCP, the way a client will.
 *
 * The unit-level behaviour lives in abap-sql and is tested there. What can
 * only break here is the wiring: the binary starting at all, the transport
 * connecting, the tools registering with the annotations we promise, and the
 * results coming back as parseable JSON.
 *
 * Run: node test/smoke.mjs
 */

import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/server.js"] }));

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse(result.content[0].text);
};

const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  ["abap_sql_explain", "abap_sql_prepare", "abap_sql_query", "abap_sql_rules"],
  "the four tools register",
);

// Every tool is read-only: the data-preview console cannot write.
for (const tool of tools) {
  assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is read-only`);
  assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} is non-destructive`);
}

// Only the querying tool reaches outside this process, and it says so.
const reaching = tools.filter((t) => t.annotations?.openWorldHint === true).map((t) => t.name);
assert.deepEqual(reaching, ["abap_sql_query"], "only abap_sql_query touches a remote system");

// Unconfigured, it declines and explains rather than throwing or hanging.
const unconfigured = await call("abap_sql_query", { sql: "SELECT vbeln FROM vbak" });
assert.equal(unconfigured.ok, false);
assert.match(unconfigured.error, /SAP_URL/);

const fixed = await call("abap_sql_prepare", { sql: "SELECT COUNT(DISTINCT kunnr) FROM vbak" });
assert.equal(fixed.ok, true);
assert.equal(fixed.statement, "SELECT COUNT( DISTINCT kunnr ) FROM vbak");

const refused = await call("abap_sql_prepare", { sql: "SELECT a FROM t LIMIT 10" });
assert.equal(refused.ok, false);
assert.equal(refused.rule, "no-limit");
assert.match(refused.fix, /row limit/);

const checked = await call("abap_sql_explain", { sql: "SELECT p.vbeln FROM vbap AS p" });
assert.equal(checked.problems[0].rule, "field-separator");

const rules = await call("abap_sql_rules", {});
assert.ok(rules.rules.length >= 5, "the rule list is populated");
assert.equal(rules.limit, 255);

await client.close();
console.log("smoke: ok (4 tools, annotations, prepare, explain, query, rules)");
