import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestions, MAX_QUESTIONS } from "../lib/types";
import { parseAnswers } from "../lib/validate";

/* ---------------- parseQuestions ---------------- */

test("parses well-formed questions and coerces required to boolean", () => {
  const out = parseQuestions([
    { label: "What are you building?", required: true },
    { label: "Budget?", required: "yes" }, // truthy but not true
    { label: "Anything else?" },
  ]);
  assert.deepEqual(out, [
    { label: "What are you building?", required: true },
    { label: "Budget?", required: false },
    { label: "Anything else?", required: false },
  ]);
});

test("drops garbage entries and empty labels", () => {
  const out = parseQuestions([
    null,
    42,
    "string",
    { required: true },
    { label: "   " },
    { label: "Real question", required: false },
  ]);
  assert.deepEqual(out, [{ label: "Real question", required: false }]);
});

test("caps at MAX_QUESTIONS and truncates long labels", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ label: `Q${i} ${"x".repeat(300)}` }));
  const out = parseQuestions(many);
  assert.equal(out.length, MAX_QUESTIONS);
  assert.ok(out.every((q) => q.label.length <= 200));
});

test("non-array input yields empty list", () => {
  assert.deepEqual(parseQuestions(null), []);
  assert.deepEqual(parseQuestions("nope"), []);
  assert.deepEqual(parseQuestions({ label: "obj" }), []);
});

/* ---------------- parseAnswers ---------------- */

const QUESTIONS = [
  { label: "Required one", required: true },
  { label: "Optional one", required: false },
];

test("missing required answer fails with the question named", () => {
  const r = parseAnswers(["", "something"], QUESTIONS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Required one/);
});

test("whitespace-only does not satisfy a required question", () => {
  const r = parseAnswers(["   ", ""], QUESTIONS);
  assert.equal(r.ok, false);
});

test("optional questions may be skipped; display joins answered pairs", () => {
  const r = parseAnswers(["An agent for invoicing"], QUESTIONS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.answers, [
      { label: "Required one", answer: "An agent for invoicing" },
    ]);
    assert.equal(r.display, "Required one\nAn agent for invoicing");
  }
});

test("answers are trimmed and capped at 2000 chars", () => {
  const r = parseAnswers([`  ${"a".repeat(3000)}  `], [{ label: "Q", required: true }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.answers[0].answer.length, 2000);
});

test("no questions means anything submitted is ignored", () => {
  const r = parseAnswers(["stray"], []);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.answers, []);
    assert.equal(r.display, null);
  }
});

test("non-array answers input treated as all-empty", () => {
  const ok = parseAnswers(undefined, [{ label: "Opt", required: false }]);
  assert.equal(ok.ok, true);
  const bad = parseAnswers(undefined, QUESTIONS);
  assert.equal(bad.ok, false);
});