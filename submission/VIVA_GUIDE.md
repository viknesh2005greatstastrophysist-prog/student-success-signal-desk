# How to explain the project

## The project in thirty seconds

Our project helps a faculty mentor notice students who may need support. Four collectors gather different signals: academic records, learning activity, internship progress and placement activity. The coordinator combines them, applies the mentor's chosen thresholds and asks a recommendation specialist for a support plan. A checker rejects unsupported claims. Nothing is published until the assigned mentor approves it. Every decision is recorded and an approved publication can be withdrawn and restored.

## Why this is an agentic system

A chatbot usually receives a message and returns text. This system maintains a plan, calls tools, processes several students, checks results, repairs failures, saves progress and pauses for a human decision. Those controlled steps make the workflow agentic. Each agent has a defined responsibility and a typed input and output. Separate agents do not require separate computers or separate language models.

## What the language model actually does

The configured local Qwen model chooses and orders allowed recommendation actions and may choose a due interval between one and fourteen days. The factual summary and citations must come from the evidence. The model cannot invent a new intervention, change grades, contact a student or approve its own work. Arithmetic, access control and publication rules are enforced by code.

We did not train or fine-tune Qwen. We built and evaluated the workflow around an existing model. The cloud demonstration currently uses the explicitly labelled rule-based mode; the live model runs locally.

## One worked example

Suppose academic records show adequate attendance and marks, but the student has nine days of LMS inactivity, two overdue assignments, one missed internship milestone and one missed placement activity. The demonstration score is 20 + 10 + 15 + 15 = 60. This passes the high-concern threshold of 50. The system creates a draft with each triggering value and its source path. The mentor checks whether support is appropriate before approving it.

The score is not a probability of failure. A score of 60 does not mean a 60 percent chance of failing. The demonstration weights have not been statistically validated on real students.

## Why retrieval and checkpoints are different

Retrieval finds relevant guidance and the same student's prior support history. Checkpoints remember where the current execution stopped. A checkpoint is like a saved game; retrieval is like looking up a relevant page in a reference book. The current implementation uses tag filtering and lexical vector similarity, not a pretrained semantic embedding model.

## What happens when something fails

Missing, stale or incorrectly scoped evidence blocks the case. Invalid recommendation fields trigger a diagnosis and up to two targeted repair attempts. A model outage or unresolved invalid response produces a clearly labelled, validated rule-based fallback. A stopped process can resume from a saved database checkpoint. A student cannot be published a draft simply because the model returned some text.

## What parallel processing changes

Four source reads can happen together, and up to four student jobs run in one request. Results remain associated with the correct student. The included benchmark compares eight students sequentially and in parallel, verifies identical results and records both timings. It simulates a known source delay; it is not a measurement of production traffic capacity.

## What mentor approval means

Approval refers to one exact artifact version and content hash. Mentor edits create another version that must pass validation. Withdrawing a publication hides it from the student and parent while retaining its history. Restoration republishes the same approved version. No academic record or actual payment changes during this process.

## What the tests prove

Unit tests check calculations, privacy filtering, citations, domain rules, malformed model responses and repairs. Database tests check saved progress, permissions, approval and rollback. Browser tests check real logins and shared state across the portals. These tests prove the demonstrated software behavior. They do not prove better grades, predictive accuracy or actual faculty approval.

## What remains outside the software

The worklet book requires a real-case demonstration. The supplied records and mentor accounts are synthetic. A real pilot needs institutional permission, source adapters, a real mentor-approved policy and actual review. If the professor accepts synthetic data instead, record that decision. Do not claim either approval or a real pilot without evidence.
