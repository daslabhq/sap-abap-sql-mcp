# SAP ABAP SQL (MCP server)

[![tests](https://github.com/daslabhq/sap-abap-sql-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/daslabhq/sap-abap-sql-mcp/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/sap-abap-sql-mcp)](https://www.npmjs.com/package/sap-abap-sql-mcp)

Checks and fixes ABAP Open SQL before it reaches SAP's ADT data-preview console.

If you have pointed an LLM at an on-premise SAP system, you have seen these:

| You sent | SAP said |
| --- | --- |
| `SELECT SUM(netwr) FROM vbap` | `400 Unknown column name "SUM(NETWR)"` |
| `SELECT COUNT(DISTINCT kunnr) FROM vbak` | `400 ")" is invalid here (due to grammar)` |
| `SELECT a FROM t WHERE (x = '1' OR y = '2')` | `400 ") " was expected here.` |

Three errors, three apparent rules, one actual cause: **the parser wants a space on the inside of every parenthesis.** It even tells you in the third one. All three pass once spaced.

Nothing in those messages says "add spaces", so a model guesses. In one recorded session the same malformed statement went out **ten times in a row**, varying only a literal. Across two sessions, 57 of 211 tool calls failed, most of them on dialect.

This server knows the rules, so your agent does not have to rediscover them.

## Which dialect this is

The **ADT data-preview console** (`/sap/bc/adt/datapreview/freestyle`), which is where agents and ADT clients read tables over HTTP. Open SQL written *inside an ABAP program* is a different dialect: it has `INTO TABLE`, `UP TO n ROWS`, `@host` variables, and no character ceiling. Do not point this at program source and expect it to be right.

On-premise systems (ECC, S/4HANA on-prem, private cloud). If you are on S/4HANA Cloud with proper OData APIs, you do not need any of this.

## Does it touch my system?

Only if you tell it to, and only from your own machine.

Three of the four tools are pure functions over a statement you pass in: no connection, no credential, no network call. They are the default, and they work with no configuration at all.

The fourth, `abap_sql_query`, runs a statement against a system you configure and returns rows. Credentials live in this server's environment on your machine. Nothing is proxied through anyone else and nothing is stored.

```json
{
  "mcpServers": {
    "sap-abap-sql": {
      "command": "npx",
      "args": ["-y", "sap-abap-sql-mcp"],
      "env": {
        "SAP_URL": "https://your-system:44300",
        "SAP_USER": "...",
        "SAP_PASSWORD": "...",
        "SAP_HEADERS": "X-Your-Proxy-Token: ..."
      }
    }
  }
}
```

`SAP_HEADERS` is optional, one `Name: value` per line. On-premise systems are rarely reached directly: they sit behind a tunnel or proxy, and if that gates on a header of its own then every request is rejected before SAP ever sees it. The symptom is a 403 that reads exactly like "ADT is switched off", and is not.

Read-only by construction: the data-preview console cannot write, so there is no write path to misuse.

## Install

```json
{
  "mcpServers": {
    "sap-abap-sql": {
      "command": "npx",
      "args": ["-y", "sap-abap-sql-mcp"]
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `abap_sql_prepare` | Returns the statement to send, or refuses it and names the correction |
| `abap_sql_explain` | Decodes a statement the console rejected, without rewriting it |
| `abap_sql_query` | Runs a prepared statement against your configured system and returns rows |
| `abap_sql_rules` | Lists the ways this dialect differs from standard SQL |

All read-only, no side effects.

```
abap_sql_prepare  SELECT COUNT(DISTINCT kunnr) FROM vbak
→ { "ok": true, "statement": "SELECT COUNT( DISTINCT kunnr ) FROM vbak", "length": 40, "limit": 255 }

abap_sql_prepare  SELECT a FROM t LIMIT 10
→ { "ok": false, "rule": "no-limit",
    "fix": "ABAP Open SQL has no LIMIT. Cap the result with the reader's row limit instead." }
```

The five rules also arrive in the server's `instructions` on connect, so your client has them before it writes anything. `abap_sql_rules` is there for when you want them back explicitly.

## What it knows

**Parenthesis spacing**, everywhere it is required at once: aggregates, `DISTINCT`, subqueries, boolean groups. `COUNT(*)` stays compact, since the parser takes it either way and every character counts against the limit below.

**The 255-character ceiling.** The console accepts 255 and rejects 256, measured with whitespace collapsed. Wrapping across lines buys nothing, and the check runs *after* rewriting, because spacing makes statements longer. This one shapes how you plan a query: anything real has to be split and joined on your side.

**`LIMIT`, `DESC`/`ASC`, and dot-qualified fields**, refused with the ABAP form named. `p.vbeln` is not a typo the parser forgives, it is three tokens.

**Where the literals are.** A parenthesis inside `'PUMP (SPARE)'` is data, and so is a double space. Both ABAP string forms and the comment form are understood, so a rewrite never changes what a statement asks for. This is the part a regex gets wrong quietly rather than loudly.

## What it will not do for you

Two limits are the console's, not ours, and they shape everything you can ask:

**255 characters per statement**, so anything real has to be split into several statements and joined on your side. No window functions, no CTEs, no running totals.

**5,000 rows, hard.** A result at the cap is reported as `truncated` rather than handed back as if complete, because a client-side total over a silently truncated result is confidently wrong. That failure mode is worse than an error.

If you find yourself stitching four statements together to answer one question, that is the console, and no client fixes it.

## Scope

This prepares statements and optionally runs them. It does not browse objects, execute ABAP, write anything, or know what your tables mean.

The dialect logic lives in [`abap-sql`](https://github.com/daslabhq/abap-sql) if you would rather call a library than run a server. Tokenizing is [abaplint](https://abaplint.org)'s lexer, which is the one correct ABAP tokenizer in TypeScript.

Built by [Daslab](https://daslab.run). We connect agents to on-premise ERP systems. Connecting one from outside the network is its own problem, and there is a free write-up of what actually works: [connecting an on-premise S/4HANA over HTTP](https://daslab.run/docs/sap-s4hana/on-prem).

## License

MIT
