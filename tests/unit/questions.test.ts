import assert from "node:assert/strict";
import { test } from "vitest";
import { durationChoices, parseLocations, parseQuestions, MAX_QUESTIONS, type BookingQuestion } from "../../lib/types";
import { parseAnswers, parseGuests, parseUtm } from "../../lib/validate";

/* ---------------- parseQuestions ---------------- */

test("v1 questions (label + required) become long_text with generated ids", () => {
  const out = parseQuestions([
    { label: "What are you building?", required: true },
    { label: "Budget?", required: "yes" }, // truthy but not true
  ]);
  assert.deepEqual(out, [
    { id: "q1", label: "What are you building?", type: "long_text", required: true },
    { id: "q2", label: "Budget?", type: "long_text", required: false },
  ]);
});

test("typed questions keep their type and options; choice questions need options", () => {
  const out = parseQuestions([
    { id: "size", label: "Team size", type: "single_choice", options: ["1", "2-10", " ", "11+"], required: true },
    { label: "No options", type: "dropdown", options: [] },
    { id: "tel", label: "Phone", type: "phone" },
    { label: "Bad type", type: "file_upload" },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: "size", label: "Team size", type: "single_choice", required: true, options: ["1", "2-10", "11+"] });
  assert.equal(out[1].type, "phone");
  assert.equal(out[2].type, "long_text");
});

test("drops garbage, caps at MAX_QUESTIONS, truncates labels, de-duplicates ids", () => {
  assert.deepEqual(parseQuestions([null, 42, "s", { required: true }, { label: "  " }]), []);
  const many = Array.from({ length: 15 }, (_, i) => ({ id: "same", label: `Q${i} ${"x".repeat(300)}` }));
  const out = parseQuestions(many);
  assert.equal(out.length, MAX_QUESTIONS);
  assert.ok(out.every((q) => q.label.length <= 200));
  assert.equal(new Set(out.map((q) => q.id)).size, out.length);
  assert.deepEqual(parseQuestions({ label: "obj" }), []);
});

/* ---------------- parseAnswers ---------------- */

const QS: BookingQuestion[] = [
  { id: "need", label: "Required one", type: "long_text", required: true },
  { id: "opt", label: "Optional one", type: "short_text", required: false },
  { id: "size", label: "Team size", type: "single_choice", required: false, options: ["1", "2-10"] },
  { id: "tools", label: "Tools", type: "multi_choice", required: false, options: ["Slack", "Notion", "Gmail"] },
  { id: "phone", label: "Phone", type: "phone", required: false },
];

test("missing required answer fails with the question named; whitespace doesn't count", () => {
  for (const raw of [["", "x"], ["   "]]) {
    const r = parseAnswers(raw, QS);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Required one/);
  }
});

test("answers by position or by id; display joins answered pairs", () => {
  const byPos = parseAnswers(["An invoicing agent"], QS);
  const byId = parseAnswers({ need: "An invoicing agent" }, QS);
  for (const r of [byPos, byId]) {
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.answers, [{ id: "need", label: "Required one", answer: "An invoicing agent" }]);
      assert.equal(r.display, "Required one\nAn invoicing agent");
    }
  }
});

test("choice answers must be offered options; multi-choice joins", () => {
  assert.equal(parseAnswers({ need: "x", size: "500" }, QS).ok, false);
  assert.equal(parseAnswers({ need: "x", tools: ["Slack", "Jira"] }, QS).ok, false);
  const r = parseAnswers({ need: "x", size: "2-10", tools: ["Slack", "Gmail"] }, QS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.answers.find((a) => a.id === "size")!.answer, "2-10");
    assert.equal(r.answers.find((a) => a.id === "tools")!.answer, "Slack, Gmail");
  }
});

test("phone answers are validated loosely", () => {
  assert.equal(parseAnswers({ need: "x", phone: "+1 (312) 555-0100" }, QS).ok, true);
  assert.equal(parseAnswers({ need: "x", phone: "call me" }, QS).ok, false);
});

test("long answers are capped by type", () => {
  const r = parseAnswers({ need: "a".repeat(5000), opt: "b".repeat(900) }, QS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.answers[0].answer.length, 4000);
    assert.equal(r.answers[1].answer.length, 500);
  }
});

/* ---------------- guests, utm, locations, durations ---------------- */

test("guests: valid, de-duplicated, booker excluded, capped", () => {
  assert.deepEqual(parseGuests("a@x.io, B@x.io; a@x.io me@x.io", 5, "me@x.io"), ["a@x.io", "b@x.io"]);
  assert.deepEqual(parseGuests(["nope"], 5, "me@x.io"), { error: '"nope" is not a valid guest email.' });
  assert.ok("error" in (parseGuests(["a@x.io", "b@x.io"], 1, "me@x.io") as object));
});

test("utm keeps only known keys", () => {
  assert.deepEqual(parseUtm({ utm_source: " ig ", evil: "x", ref: "bio" }), { utm_source: "ig", ref: "bio" });
  assert.equal(parseUtm({ evil: "x" }), null);
});

test("locations default to Google Meet and drop kinds missing their detail", () => {
  assert.deepEqual(parseLocations(undefined), [{ kind: "google_meet" }]);
  assert.deepEqual(parseLocations([{ kind: "in_person" }, { kind: "phone_invitee" }]).map((l) => l.kind), ["phone_invitee"]);
  assert.equal(parseLocations([{ kind: "link", value: "https://zoom.us/j/1" }])[0].value, "https://zoom.us/j/1");
});

test("duration choices always include the default and inherit its price", () => {
  const out = durationChoices({ durationMinutes: 30, priceCents: 6900, durationOptions: [{ minutes: 60, priceCents: 12900 }, { minutes: 15 }, { minutes: 30 }] });
  assert.deepEqual(out, [
    { minutes: 15, priceCents: 6900 },
    { minutes: 30, priceCents: 6900 },
    { minutes: 60, priceCents: 12900 },
  ]);
});
