import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addDays,
  byUrgency,
  collegeDate,
  daysBetween,
  deadlineDate,
  MEET_WITHIN_DAYS,
  meetByDate,
  MEETING_REASONS,
  meetingOutcome,
  meetingTimeline,
  REPORT_NOTE_PREFIX,
  reportCheckinNote,
  SUBMIT_WITHIN_DAYS,
  validateMeeting,
} from "../lib/meetings";
import { messageBody, prettyName, reminderText } from "../lib/staff-messages";

/** The conversation with the student about the AI report (owner decisions, 17 Oct): the
 * check-in's due date and note, and the meeting record's checks. Pure functions; no
 * database. */

const code = (error: unknown) => (error as { code?: string }).code;

test("the check-in is due 7 days after the AI report and its note names the report", () => {
  assert.equal(meetByDate("2026-10-16"), "2026-10-23");
  assert.equal(reportCheckinNote("2026-10-16"), "Meet the student about the AI report of 16 Oct 2026");
  assert.ok(reportCheckinNote("2026-10-16").startsWith(REPORT_NOTE_PREFIX), "the family-facing read hides notes with this prefix");
});

test("the 7 and 14 day rules: due before day 7, meet by now on days 7 to 14, past the deadline after day 14", () => {
  assert.equal(MEET_WITHIN_DAYS, 7);
  assert.equal(SUBMIT_WITHIN_DAYS, 14);
  const report = "2026-10-01";
  assert.equal(meetByDate(report), "2026-10-08");
  assert.equal(deadlineDate(report), "2026-10-15");
  const at = (day: string) => meetingTimeline(report, day, false);
  // Before day 7: due, with the days left until the meet-by day.
  assert.deepEqual(
    { stage: at("2026-10-01").stage, since: at("2026-10-01").days_since, left: at("2026-10-01").days_left, overdue: at("2026-10-01").days_overdue },
    { stage: "due", since: 0, left: 7, overdue: null },
    "the report day",
  );
  assert.deepEqual([at("2026-10-07").stage, at("2026-10-07").days_left], ["due", 1], "day 6");
  // Day 7 the card turns to "Meet by now" on its own, and stays so until day 14.
  assert.deepEqual([at("2026-10-08").stage, at("2026-10-08").days_overdue, at("2026-10-08").days_left], ["meet_now", 0, null], "day 7");
  assert.deepEqual([at("2026-10-12").stage, at("2026-10-12").days_overdue], ["meet_now", 4], "day 11");
  assert.deepEqual([at("2026-10-15").stage, at("2026-10-15").days_overdue], ["meet_now", 7], "day 14 is still in time");
  // After day 14 without a submitted conversation: the department head sees it.
  assert.deepEqual([at("2026-10-16").stage, at("2026-10-16").days_overdue, at("2026-10-16").days_since], ["past_deadline", 8, 15], "day 15");
  assert.equal(at("2026-11-30").stage, "past_deadline");
  // A submitted conversation is done, whatever the day.
  for (const day of ["2026-10-02", "2026-10-10", "2026-10-30"]) {
    const met = meetingTimeline(report, day, true);
    assert.equal(met.stage, "met", day);
    assert.equal(met.days_left, null);
    assert.equal(met.days_overdue, null);
  }
  // The dates travel with the stage.
  assert.deepEqual(
    { report: at("2026-10-16").report_on, meetBy: at("2026-10-16").meet_by, deadline: at("2026-10-16").deadline },
    { report, meetBy: "2026-10-08", deadline: "2026-10-15" },
  );
  // Across a month and a year end.
  assert.equal(meetByDate("2026-12-28"), "2027-01-04");
  assert.equal(deadlineDate("2026-12-28"), "2027-01-11");
  assert.equal(meetingTimeline("2026-12-28", "2027-01-12", false).stage, "past_deadline");
});

test("a report at 00:30 IST starts the clock on that Indian day", () => {
  // 19:00 UTC on 30 Sep is 00:30 IST on 1 Oct.
  const report = collegeDate("2026-09-30T19:00:00Z");
  assert.equal(report, "2026-10-01");
  assert.equal(meetingTimeline(report, "2026-10-08", false).stage, "meet_now");
  assert.equal(meetingTimeline(report, "2026-10-07", false).stage, "due");
});

test("the most urgent conversation comes first: the oldest report without one, submitted ones last", () => {
  const row = (student_name: string, days_since: number, stage: "due" | "meet_now" | "past_deadline" | "met") => ({ student_name, days_since, stage });
  const sorted = [row("Asha", 3, "due"), row("Dev", 20, "met"), row("Bharat", 16, "past_deadline"), row("Chitra", 9, "meet_now"), row("Ekta", 3, "due")].sort(byUrgency);
  assert.deepEqual(sorted.map((r) => r.student_name), ["Bharat", "Chitra", "Asha", "Ekta", "Dev"]);
});

test("the department head's reminder: the standard words, the student's name as the screens show it, and an optional note", () => {
  assert.equal(prettyName("ASHA RAO"), "Asha Rao");
  assert.equal(prettyName("Asha D'Souza"), "Asha D'Souza", "mixed case is kept");
  assert.equal(prettyName("NEHA D'SOUZA"), "Neha D'Souza");
  assert.equal(prettyName(""), "");
  const text = reminderText("BHARAT KULKARNI", "2026-10-01");
  assert.equal(
    text,
    "The conversation with Bharat Kulkarni about the AI report of 1 Oct 2026 has not been submitted. Please meet the student and record it, or tell me why not.",
  );
  assert.equal(messageBody(text, "   "), text, "no note: the reminder alone");
  assert.equal(messageBody(text, "  Please do it this week. "), `${text}\n\nPlease do it this week.`);
});

test("dates are calendar days in the college's time zone (India)", () => {
  // 19:00 UTC on 16 Oct is 00:30 IST on 17 Oct: an approval then counts on the 17th.
  assert.equal(collegeDate("2026-10-16T19:00:00Z"), "2026-10-17");
  assert.equal(collegeDate("2026-10-16T18:00:00Z"), "2026-10-16");
  assert.equal(meetByDate(collegeDate("2026-10-16T19:00:00Z")), "2026-10-24", "a report at 00:30 IST counts on the 17th");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02", "across a month end");
  assert.equal(daysBetween("2026-10-10", "2026-10-17"), 7);
  assert.equal(daysBetween("2026-10-17", "2026-10-10"), -7);
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

test("a meeting record needs a real date that is not in the future or before the AI report, and at least one reason", () => {
  const today = "2026-10-17";
  const ok = validateMeeting(
    { metOn: "2026-10-15", reasons: ["Course difficulty", "Health", "Health"], note: "  Tired after a fever  ", agreedNextStep: " Two tutorials a week " },
    { today, reportOn: "2026-10-10" },
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
    [{ metOn: "2026-10-09", reasons: ["Health"] }, "MEETING_BEFORE_REPORT"],
    [{ metOn: "2026-10-15", reasons: [] }, "MEETING_REASON_REQUIRED"],
    [{ metOn: "2026-10-15", reasons: ["Bored"] }, "MEETING_REASON_UNKNOWN"],
    [{ metOn: "2026-10-15", reasons: ["Health", "health"] }, "MEETING_REASON_UNKNOWN"],
  ];
  for (const [input, expected] of refused)
    assert.throws(() => validateMeeting(input, { today, reportOn: "2026-10-10" }), (e) => code(e) === expected, JSON.stringify(input));
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
