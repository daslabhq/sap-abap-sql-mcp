# SAP ABAP SQL (MCP server)

Write ABAP Open SQL that SAP's ADT data-preview console will actually accept.

**It connects to nothing.** No SAP system, no credential, no network call. Every tool is a pure function over a statement you pass in. Point it at your assistant and pair it with whichever ADT client you already use.

## Install

```json
{
  "mcpServers": {
    "sap-abap-sql": {
      "command": "npx",
      "args": ["-y", "@daslabhq/sap-abap-sql-mcp"]
    }
  }
}
```

## Why

The data-preview console (`/sap/bc/adt/datapreview/freestyle`) is the widest read surface an on-premise ABAP system exposes over HTTP. It reaches any table and needs no database user, which is why every ADT client and agent bridge ends up on it.

It is also strict in ways its error messages do not explain. These three fail on a live system:

| Sent | Response |
| --- | --- |
| `SELECT SUM(netwr) FROM vbap` | `400 Unknown column name "SUM(NETWR)"` |
| `SELECT COUNT(DISTINCT kunnr) FROM vbak` | `400 ")" is invalid here (due to grammar)` |
| `SELECT a FROM t WHERE (x = '1' OR y = '2')` | `400 ") " was expected here.` |

Three messages, three apparent rules, one actual cause: the parser wants a space on the inside of every parenthesis. It says so itself in the third message.

An agent that does not know this burns its session rediscovering it. In one recorded run, the same malformed statement was sent ten times, varying only a literal.

## Tools

| Tool | What it does |
| --- | --- |
| `abap_sql_prepare` | Returns the statement to send, or refuses it and names the correction |
| `abap_sql_check` | Reports every dialect problem without rewriting, each with a rule id |
| `abap_sql_rules` | Lists the ways this dialect differs from standard SQL |

All three are read-only and have no side effects.

```
abap_sql_prepare  SELECT COUNT(DISTINCT kunnr) FROM vbak
→ { "ok": true, "statement": "SELECT COUNT( DISTINCT kunnr ) FROM vbak", "length": 40, "limit": 255 }

abap_sql_prepare  SELECT a FROM t LIMIT 10
→ { "ok": false, "rule": "no-limit",
    "fix": "ABAP Open SQL has no LIMIT. Cap the result with the reader's row limit instead." }
```

## What it knows

- **Parenthesis spacing**, everywhere it is required at once: aggregates, `DISTINCT`, subqueries, boolean groups. `COUNT(*)` stays compact, since the parser takes it either way and every character counts.
- **The 255-character ceiling**, measured after normalization. The console rejects 256 and accepts 255, and wrapping across lines buys nothing.
- **`LIMIT`, `DESC`/`ASC`, and dot-qualified fields**, refused with the ABAP form named.
- **Where the literals are.** A parenthesis inside `'INGOT (AL)'` is data, and so is a double space. Both string forms and the comment form are understood, so a rewrite never changes what a statement asks for.

Tokenization is [abaplint](https://abaplint.org)'s lexer. The dialect logic is [`abap-sql`](https://github.com/daslabhq/abap-sql), which you can use directly if you would rather not run a server.

## Scope

This prepares statements. It does not connect, authenticate, read data, or know anything about your system.

## License

MIT
