import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addDays,
  backfillDueOn,
  checkinDueOn,
  checkinWindowDays,
  collegeDate,
  daysBetween,
  DEFAULT_CHECKIN_DAYS,
  MEETING_REASONS,
  meetingOutcome,
  validateMeeting,
} from "../lib/meetings";

/** Meeting records after a support plan (owner request, 17 Oct): the check-in's due
 * date and the meeting record's checks. Pure functions; no database. */

const code = (error: unknown) => (error as { code?: string }).code;

test("the check-in is due on the approval day plus the plan's earliest action window", () => {
  const plan = {
    actions: [
      { code: "faculty-check-in", label: "Check-in", owner: "assigned_faculty", dueInDays: 10 },
      { code: "student-study-plan", label: "Study plan", owner: "student", dueInDays: 5 },
    ],
  };
  assert.equal(checkinWindowDays(plan), 5, "the earliest window");
  assert.equal(checkinDueOn("2026-10-16T06:00:00Z", plan), "2026-10-21");
  // No action with a window: 7 days.
  for (const none of [{}, { actions: [] }, { actions: [{ label: "No window" }] }, null, undefined, "x"])
    assert.equal(checkinWindowDays(none), DEFAULT_CHECKIN_DAYS);
  assert.equal(checkinDueOn("2026-10-16T06:00:00Z", { actions: [] }), "2026-10-23");
  // Odd values are ignored rather than trusted.
  assert.equal(checkinWindowDays({ actions: [{ dueInDays: 0 }, { dueInDays: -3 }, { dueInDays: 2.5 }, { dueInDays: "4" }] }), 4);
});

test("dates are calendar days in the college's time zone (India)", () => {
  // 19:00 UTC on 16 Oct is 00:30 IST on 17 Oct: an approval then counts on the 17th.
  assert.equal(collegeDate("2026-10-16T19:00:00Z"), "2026-10-17");
  assert.equal(collegeDate("2026-10-16T18:00:00Z"), "2026-10-16");
  assert.equal(checkinDueOn("2026-10-16T19:00:00Z", { actions: [{ dueInDays: 3 }] }), "2026-10-20");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02", "across a month end");
  assert.equal(daysBetween("2026-10-10", "2026-10-17"), 7);
  assert.equal(daysBetween("2026-10-17", "2026-10-10"), -7);
});

test("a plan approved before meeting records gets a check-in due 7 days after its approval", () => {
  assert.equal(backfillDueOn("2026-10-01T05:00:00Z"), "2026-10-08");
  assert.equal(backfillDueOn(new Date("2026-09-28T20:00:00Z")), "2026-10-06", "29 Sep in India, plus 7");
});

test("completing the check-in records the day they met", () => {
  assert.equal(meetingOutcome("2026-10-05"), "Met on 5 Oct 2026");
  assert.equal(meetingOutcome("2026-12-31"), "Met on 31 Dec 2026");
});

test("the reasons are the fixed list, in order, and migration 014 allows exactly that list", () => {
  assert.deepEqual([...MEETING_REASONS], [
    "Health",
    "Family responsibilities",
    "Financial pressure",
    "Transport or distance",
    "Course difficulty",
    "Lost motivation or interest",
    "Part-time work",
    "Personal or mental-health concern",
    "Timetable clash",
    "Other",
  ]);
  const sql = readFileSync(new URL("../migrations/014_meeting_records.sql", import.meta.url), "utf8");
  const listed = /reasons <@ ARRAY\[([\s\S]*?)\]::text\[\]/.exec(sql)![1]!.match(/'([^']+)'/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(listed, [...MEETING_REASONS]);
});

test("a meeting record needs a real date that is not in the future or before the plan, and at least one reason", () => {
  const today = "2026-10-17";
  const ok = validateMeeting(
    { metOn: "2026-10-15", reasons: ["Course difficulty", "Health", "Health"], note: "  Tired after a fever  ", agreedNextStep: " Two tutorials a week " },
    { today, approvedOn: "2026-10-10" },
  );
  assert.deepEqual(ok, {
    metOn: "2026-10-15",
    reasons: ["Health", "Course difficulty"],
    note: "Tired after a fever",
    agreedNextStep: "Two tutorials a week",
  }, "reasons in the list's order, each once; text trimmed");
  assert.equal(validateMeeting({ metOn: today, reasons: ["Timetable clash"] }, { today }).metOn, today, "today is allowed");
  const refused: Array<[Parameters<typeof validateMeeting>[0], string]> = [
    [{ metOn: "2026-10-18", reasons: ["Health"] }, "MEETING_DATE_IN_FUTURE"],
    [{ metOn: "2026-02-30", reasons: ["Health"] }, "MEETING_DATE_INVALID"],
    [{ metOn: "17/10/2026", reasons: ["Health"] }, "MEETING_DATE_INVALID"],
    [{ metOn: "", reasons: ["Health"] }, "MEETING_DATE_INVALID"],
    [{ metOn: "2026-10-09", reasons: ["Health"] }, "MEETING_BEFORE_PLAN"],
    [{ metOn: "2026-10-15", reasons: [] }, "MEETING_REASON_REQUIRED"],
    [{ metOn: "2026-10-15", reasons: ["Bored"] }, "MEETING_REASON_UNKNOWN"],
    [{ metOn: "2026-10-15", reasons: ["Health", "health"] }, "MEETING_REASON_UNKNOWN"],
  ];
  for (const [input, expected] of refused)
    assert.throws(() => validateMeeting(input, { today, approvedOn: "2026-10-10" }), (e) => code(e) === expected, JSON.stringify(input));
});

test("the reason Other needs a note saying what it was", () => {
  const today = "2026-10-17";
  for (const note of [undefined, "", "  ", "ok"])
    assert.throws(
      () => validateMeeting({ metOn: "2026-10-16", reasons: ["Other"], note }, { today }),
      (e) => code(e) === "MEETING_NOTE_REQUIRED" && (e as Error).message === "Add a note saying what the other reason was.",
    );
  assert.deepEqual(validateMeeting({ metOn: "2026-10-16", reasons: ["Other"], note: "Looks after a younger brother" }, { today }).reasons, ["Other"]);
  // Any other reason needs no note.
  assert.equal(validateMeeting({ metOn: "2026-10-16", reasons: ["Part-time work"] }, { today }).note, "");
});
