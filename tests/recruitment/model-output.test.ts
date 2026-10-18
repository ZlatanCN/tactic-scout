import assert from "node:assert/strict";
import test from "node:test";
import { structuredModelText } from "../../src/recruitment/model-output.js";

test("structured JSON accepts string and streamed text blocks without treating reasoning as evidence", () => {
  assert.equal(structuredModelText('{"task":"similarity"}'), '{"task":"similarity"}');
  assert.equal(structuredModelText([{ type: "reasoning", text: "not a visible answer" }, { type: "text", text: '{"ta' }, { type: "text", text: 'sk":"similarity"}' }]), '{"task":"similarity"}');
  assert.equal(structuredModelText([{ type: "reasoning", text: '{"task":"replacement"}' }]), "");
  assert.equal(structuredModelText('```json\n{"task":"similarity"}\n```'), '{"task":"similarity"}');
});
