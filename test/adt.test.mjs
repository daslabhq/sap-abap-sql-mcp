/**
 * The data-preview response is column-oriented, which makes its parser the one
 * place here that can be wrong without being loud: values land on the wrong
 * rows and every aggregate still reconciles.
 *
 * These are the cases that actually caused that.
 *
 * Run: node test/adt.test.mjs
 */

import assert from "node:assert";
import { parseDataPreview } from "../dist/adt.js";

const column = (name, values) =>
  `<dataPreview:columns><dataPreview:metadata dataPreview:name="${name}"/>` +
  values.map((v) => (v === null ? "<dataPreview:data/>" : `<dataPreview:data>${v}</dataPreview:data>`)).join("") +
  `</dataPreview:columns>`;

// A plain table transposes.
{
  const xml = column("VBELN", ["1", "2"]) + column("NETWR", ["10", "20"]);
  const { columns, rows } = parseDataPreview(xml);
  assert.deepEqual(columns, ["VBELN", "NETWR"]);
  assert.deepEqual(rows, [{ VBELN: "1", NETWR: "10" }, { VBELN: "2", NETWR: "20" }]);
}

// The one that matters: an empty value arrives self-closing. Dropping it
// shifts every later value in that column up a row, and the table still looks
// perfectly well-formed afterwards.
{
  const xml = column("VBELN", ["1", "2", "3"]) + column("ABGRU", [null, null, "Z1"]);
  const { rows } = parseDataPreview(xml);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.ABGRU), ["", "", "Z1"]);
  // The rejection code belongs to order 3, not order 1.
  assert.equal(rows[2].VBELN, "3");
  assert.equal(rows[0].ABGRU, "");
}

// Ragged columns mean we cannot know which value belongs to which row, so
// refuse rather than produce a confident wrong table.
{
  const xml = column("A", ["1", "2", "3"]) + column("B", ["x"]);
  assert.throws(() => parseDataPreview(xml), /disagree on row count/);
}

// Entities decode, including an ampersand that must not be double-decoded.
{
  const { rows } = parseDataPreview(column("NAME", ["Smith &amp;amp; Co", "&lt;none&gt;"]));
  assert.equal(rows[0].NAME, "Smith &amp; Co");
  assert.equal(rows[1].NAME, "<none>");
}

// An empty result is empty, not a crash.
assert.deepEqual(parseDataPreview("<nothing/>"), { columns: [], rows: [] });

console.log("adt: ok (transpose, self-closing empties, ragged refusal, entities)");
