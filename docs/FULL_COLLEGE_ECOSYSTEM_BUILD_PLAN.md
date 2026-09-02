# AURA full academic ecosystem build plan

**Status:** implementation-ready after two bounded review loops

**Product boundary:** complete synthetic academic and student-support ecosystem
across five independent portals

**Not claimed:** a complete ERP for every office in a real university

## 1. Decision

AURA will be built as five independent websites backed by one authoritative
institutional state:

1. Student Portal
2. Parent Portal
3. Faculty Portal
4. HOD Portal
5. AI Governance Console

An action in one portal must change the authorized views in the other portals.
The websites are not five isolated demos and they are not five skins over the
same dashboard. Each has its own information architecture, session, visual
identity, workflow, and deployment.

The AI surface remains a governance console, not a chatbot. It exists because
the Chapter 11 project needs visible evidence collection, deterministic policy,
bounded composition, validation, faculty approval, audit, and replay. It has no
authority to edit academic records or approve support.

### Verified starting state

| Existing asset | Verified state | Build implication |
|---|---|---|
| Five portal deployments | independently deployed and returning HTTP 200 | retain projects; replace the shared prototype page |
| Shared portal package | one static `PortalHome` and basic CSS | reuse workspace wiring, not the interface |
| Identity service | OIDC discovery is live and five public PKCE clients exist | finish login, consent, callback, and portal sessions; do not replace it |
| Database | `aura_identity` is migrated; `aura_core` exists but is empty | add a normalized synthetic domain schema |
| Legacy governed runtime | deterministic policy, validation, approval, audit, and replay patterns exist | port bounded logic and tests; do not port the single JSON-state design |
| Delivery | GitHub and all six current Vercel projects are connected | add only the Core API project |

No academic workflow or production portal login is currently proven. The build
starts from working infrastructure and non-functional portal shells.

### Binding release journey

One named CSE student, one linked parent, one assigned faculty member, one HOD,
one governance operator, and one seeded offering form the visual and test spine.
Every retained screen must serve a row below or a mandatory denial.

| ID | Actor, screen, and control | Seed condition | Durable result and visible consequence | Mandatory denial | Test |
|---|---|---|---|---|---|
| J01 | HOD, offering detail, **Publish and assign** | draft CSE offering with capacity | published version; student can see it; faculty receives assignment; causal receipts appear | ECE offering is inaccessible | `journey-hod-publish` |
| J02 | Student, registration, **Register** | eligible student and open window | registration and seat count; faculty roster and HOD count update | timetable clash or missing prerequisite returns a reason and no write | `journey-student-register` |
| J03 | Faculty, classroom, **Submit attendance** | registered roster and open attendance sheet | versioned attendance; student, granted parent, HOD, and governance views update | unassigned faculty receives 404-equivalent denial | `journey-faculty-attendance` |
| J04 | Faculty, classroom, **Publish marks** | seeded assessment and draft marks | published mark version; student, granted parent, HOD, and governance views update | mark outside assessment range fails validation | `journey-faculty-marks` |
| J05 | Parent, child record, **View academics** | active link with attendance and marks grants | only granted published fields are returned | revoked mark grant disappears on the next request | `journey-parent-scope` |
| J06 | Parent, fees, **Pay sandbox invoice** | due synthetic invoice | successful transaction changes balance and produces a downloadable receipt | declined attempt and duplicate submission do not create payment twice | `journey-parent-payment` |
| J07 | Governance, run detail, **Process academic event** | attendance or marks event in outbox | frozen evidence, policy result, cited artifact, validation, and causal receipt | missing or stale required evidence produces `DATA_BLOCKED` | `journey-agent-process` |
| J08 | Faculty, case detail, **Approve exact artifact** | current valid artifact awaiting assigned faculty | decision, support plan, audit, and outbox commit atomically | stale artifact hash or wrong faculty fails closed | `journey-faculty-approve` |
| J09 | Student, parent, and HOD dashboards, **Open consequence** | approved current support plan | role-scoped support views open from the same causal receipt | parent without support grant sees no support content | `journey-support-propagation` |
| J10 | Governance, run detail, **Replay and verify** | completed recorded run | one replay receipt verifies stored hashes | replay changes no academic, fee, decision, or outbox state | `journey-governance-replay` |

## 2. Honest scope

### Included

- Central login and five portal-local sessions
- Department, faculty, student, parent, and relationship records
- Terms, courses, offerings, registration windows, capacity, and prerequisites
- Student course registration and withdrawal
- Faculty assignment, classrooms, rosters, and seeded timetable
- Attendance sessions, attendance records, and publication
- Assessments, marks, and publication
- Synthetic fee invoices, sandbox payment attempts, and downloadable receipts
- Parent field grants and revocation
- Role-scoped causal activity history
- Governed student-support cases, exact-artifact faculty decisions, plans, and
  role-scoped publication
- Agent runs, evidence, validation, repair, fallback, replay, audit, and export
- Department-level HOD student and faculty oversight
- Deterministic reset to a known seeded institution

### Excluded

- Admissions and applicant processing
- Hostel, library, transport, payroll, procurement, and inventory
- Real payment processing
- Email, SMS, WhatsApp, or other external messaging
- Real student records or university API integrations
- Predictive failure claims, diagnosis, autonomous decisions, or online learning

Calling those excluded systems part of this build would turn a coherent
academic simulation into an unfinished ERP. The release will be complete for
the five-role academic and student-support ecosystem, not for every department
that exists in a college.

## 3. Product principles

1. **One institutional truth.** Portals never keep independent copies of domain
   records.
2. **Server-owned authority.** The Core API resolves identity, role, department,
   assignment, parent link, and field grant on every request.
3. **Visible causality.** Every mutation produces an activity event so the user
   can see where the change came from and who can now observe it.
4. **No dead controls.** Every rendered button navigates, mutates, filters,
   downloads, confirms, or explains why it is disabled.
5. **Hide unfinished work.** A future feature is absent until its route,
   command, failure state, test, and audit event exist.
6. **Synthetic by construction.** Seeded identifiers and records carry explicit
   synthetic provenance.
7. **AI has bounded value.** Code owns policy, eligibility, permissions, and
   state. The model may compose cited language only.
8. **Useful density.** The portals should feel like serious institutional tools,
   not landing pages covered in oversized cards.
9. **One shared demo, not a platform.** The synthetic release has one protected
   institution seed. It does not add tenant management or per-visitor sandboxes.

Every visible activity item is a causal receipt containing actor, action,
affected record, consequence, event ID, and an authorized deep-link. The same
event uses the same visual marker in every portal that may observe it.

## 4. Visual direction

### Concept: institutional editorial modernism

The common language combines a university register, a well-typeset annual
report, and a modern operating console. It should feel calm, rigorous, and
specific to education.

- **Typography:** Newsreader for display and folio moments; Public Sans for
  interface text and tabular work.
- **Base palette:** warm paper, carbon ink, chalk white, and muted rule lines.
- **Materials:** ledger rules, subtle paper grain, clipped annotations, semester
  stamps, and restrained depth.
- **Shape:** mostly square or lightly rounded working surfaces. Pills are
  reserved for status and compact filters.
- **Motion:** one composed page entrance, purposeful row and status transitions,
  and immediate mutation feedback. No floating blobs or decorative animation.
- **Data:** tables, registers, timelines, and annotated charts take priority over
  generic metric-card grids.
- **Accessibility:** WCAG AA contrast, visible focus, keyboard operation,
  semantic tables, reduced-motion support, and no color-only meaning.

### Shared identity, distinct products

| Portal | Visual personality | Signature surface | Accent |
|---|---|---|---|
| Student | energetic academic journal | day agenda and course-registration sheet | oxblood and marigold |
| Parent | calm household ledger | child progress and fee statement | forest and copper |
| Faculty | precise classroom register | roster and gradebook | cobalt and vermilion |
| HOD | departmental command folio | allocation register and scoped people index | ink and antique gold |
| Governance | forensic technical workstation | evidence lineage and replay trace | graphite and signal green |

The remembered detail will be the **institutional activity rail**. Every portal
shows a role-scoped timeline of changes made elsewhere, such as a published
course, submitted attendance, paid invoice, approved support plan, or verified
replay.

## 5. Runtime topology

```text
Student Portal ---------\
Parent Portal -----------\
Faculty Portal -----------> portal BFF -> Core API -> Neon PostgreSQL
HOD Portal --------------/       |           |              |
AI Governance ----------/        |           |              +-> audit ledger
                                 |           +-> outbox -----+-> agent worker
                                 |
                                 +-> central Better Auth OIDC service
```

### Deployables

- Five independent Next.js portal projects
- One Better Auth identity-service project
- One Core API project containing the domain service and idempotent worker
- One Neon database with isolated `aura_identity` and `aura_core` schemas

The worker will run from the Core API through an authenticated Governance
command. A scheduler and separate queue vendor are unnecessary for this
synthetic release.

### Portal request path

1. The browser submits to its own portal.
2. The portal BFF reads its HTTP-only local session.
3. The BFF calls the Core API with the OIDC access token and idempotency key.
4. The Core API validates token signature, issuer, audience, expiry, and client.
5. The Core API loads the subject's current server-side assignments and grants.
6. The Core API authorizes and commits the command in one database transaction.
7. The response returns the new resource version and emitted activity ID.

Tokens, roles, department IDs, and student IDs supplied by browser state never
become authorization facts.

### Browser-security contract

- Authorization Code with PKCE uses exact HTTPS redirects, state, and nonce.
- Access and refresh tokens remain server-side and never enter browser storage.
- Portal sessions use exact-origin `Secure`, `HttpOnly`, `SameSite=Lax`,
  `__Host-` cookies and rotate after login.
- Every state-changing portal request requires a CSRF token and matching
  `Origin` or `Referer` host.
- Core API CORS is deny-by-default because browsers call their portal BFF, not
  the Core API directly.
- Sign-out invalidates the portal session and revokes usable provider tokens.
- Expired, revoked, wrong-client, wrong-audience, and wrong-portal sessions fail
  before a domain query runs.
- Return URLs are allowlisted to prevent open redirects.

## 6. Deterministic simulation world

The seed will be fixed and repeatable so tests and demonstrations tell the same
story after every reset.

| Entity | Seed volume |
|---|---:|
| Fictional institution | 1 |
| Departments | 2, CSE and ECE |
| HOD accounts | 2 |
| Faculty accounts | 4, three CSE and one ECE |
| Student accounts | 12, ten CSE and two ECE |
| Parent or guardian accounts | 9 |
| Courses | 6 |
| Term offerings | 6 |
| Rooms and timetable blocks | 3 rooms, 8 blocks |
| Attendance history | 4 teaching weeks |
| Assessments | 2 per active offering |
| Fee invoices | one per seeded student with mixed states |
| Support cases | 3 across blocked, review, and approved states |

The CSE slice provides the main demonstration. ECE exists to prove that HODs and
faculty cannot escape their department or assignment boundaries.

### Demo identity flow

- Five seeded personas are stored as real identity-service users.
- A private `DEMO_ACCESS_PIN` unlocks a synthetic persona picker.
- Choosing a persona signs in through the central identity service and issues a
  portal-specific session.
- Existing sessions on the other portal origins remain intact, allowing all
  five roles to be demonstrated in one browser.
- Persona credentials and the access PIN never appear in the repository or the
  public UI.
- Persona selection, failed PIN attempts, and session issuance are rate-limited
  and audited. Reset additionally requires the exact seed name as confirmation.
- A real pilot would remove this flow and use institutional SSO.

## 7. Portal information architecture and action contract

### Student Portal

| Route | Working surface | Required actions |
|---|---|---|
| `/dashboard` | seeded timetable, academic pulse, fee and support summaries, causal activity | open consequence, refresh |
| `/registration` | catalogue and registration sheet with seat, prerequisite, and conflict checks | search, filter, inspect, register, withdraw, confirm, view denial |
| `/academics` | attendance and published-mark tabs | filter course, inspect session or assessment |
| `/fees` | invoice, payment status, and receipt references | inspect invoice, download existing receipt |
| `/support` | approved support plan and student-visible updates | inspect plan, acknowledge update |
| `/account` | synthetic identity and active parent grants | inspect grant, revoke permitted field, sign out |

Student actions affect registration counts, faculty rosters, HOD oversight,
causal activity, and parent access grants.

### Parent Portal

| Route | Working surface | Required actions |
|---|---|---|
| `/dashboard` | linked-child summary, urgent items, support, access, and causal activity | switch linked child, open consequence, inspect grant, refresh, sign out |
| `/children/[id]` | permitted attendance, published marks, and support tabs | filter course, inspect absence, assessment, or support plan |
| `/fees` | invoice and sandbox checkout | pay now, choose success or decline simulation, download receipt |

Payment is a labeled sandbox workflow. A successful attempt creates a payment
record and receipt; a declined attempt creates an auditable failure without
changing the invoice balance.

### Faculty Portal

| Route | Working surface | Required actions |
|---|---|---|
| `/dashboard` | today's classes, incomplete registers, case queue | open task, refresh, sign out |
| `/classes/[id]` | roster, student detail, attendance, and gradebook tabs | search, inspect student, mark attendance, submit, enter marks, publish |
| `/cases/[id]` | evidence, proposal, exact version, decision | edit allowed wording, approve, reject, record rationale |

Faculty submission updates student, parent, HOD, support-policy, and governance
views. A stale artifact cannot be approved after relevant attendance or marks
change.

### HOD Portal

| Route | Working surface | Required actions |
|---|---|---|
| `/dashboard` | registration, academic, fee, staffing, case disposition, and causal activity | change term, open consequence, refresh, sign out |
| `/offerings/[id]` | one seeded draft offering, capacity, faculty assignment, and enrolment | assign faculty, publish, inspect enrolment |
| `/people` | department faculty and student tabs with scoped detail | search, filter cohort, inspect profile |

The HOD sees all authorized student and teacher details inside one department,
not passwords, sessions, private parent credentials, or another department.

### AI Governance Console

| Route | Working surface | Required actions |
|---|---|---|
| `/dashboard` | queue, model mode, blocked work, validation health | refresh, open run |
| `/runs/[id]` | stage, evidence, validation, replay, audit, and export tabs | process academic event, inspect stage, filter evidence, compare versions, inspect failure, replay, verify hashes, download evidence |
| `/simulation` | seeded environment control | preview reset, type seed name, confirm reset, view manifest, sign out |

There is deliberately no AI chat box, academic edit button, or faculty decision
button in this portal.

## 8. Cross-portal consequence matrix

| Origin action | Immediate durable effect | Other portal consequences |
|---|---|---|
| HOD publishes offering | offering version and audit event | Student can register; faculty sees assignment |
| Student registers | registration and seat count | Faculty roster and HOD demand update |
| Student withdraws | registration status and released seat | Faculty roster and HOD demand update |
| Faculty submits attendance | versioned attendance records and outbox event | Student, permitted parent, HOD, and governance update |
| Faculty publishes marks | versioned marks and outbox event | Student, permitted parent, HOD, and governance update |
| Parent pays sandbox invoice | payment, receipt, invoice balance, audit event | Student fee status and HOD aggregate update |
| Worker creates support proposal | frozen evidence and current artifact | Faculty receives case; governance receives lineage |
| Faculty approves artifact | decision, plan, audit, outbox in one transaction | Student and permitted parent see plan; HOD sees disposition |
| Student revokes parent field | grant version and audit event | Parent loses that field on the next request |
| Governance replays run | replay receipt only | No academic, finance, or support state changes |
| Governance resets simulation | new seed generation and retained reset audit | All portals return to the frozen seed |

Cross-portal views revalidate on navigation and poll the global institution
revision every 15 seconds only while the tab is visible. A manual Refresh action
loads the new state immediately. This avoids a WebSocket system and wasteful
background database traffic.

## 9. Authority matrix

| Capability | Student | Parent | Faculty | HOD | Governance |
|---|:---:|:---:|:---:|:---:|:---:|
| Read own academic record | yes | granted child fields | assigned student | department | evidence snapshot only |
| Register for course | own | no | no | no | no |
| Record attendance or marks | no | no | assigned offering | oversight only | no |
| Publish course or assign faculty | no | no | no | department | no |
| Record sandbox payment | no | linked child | no | no | no |
| Approve support artifact | no | no | assigned case | no | no |
| Start or replay agent run | no | no | no | no | yes |
| Reset synthetic environment | no | no | no | no | yes |

Every `no` receives a negative authorization test. Hiding a button is not an
authorization control.

## 10. Core data model

### Identity and scope

- `institutions`
- `departments`
- `people`
- `role_assignments`
- `faculty_assignments`
- `student_profiles`
- `parent_links`
- `parent_field_grants`

### Academic operations

- `terms`
- `courses`
- `course_prerequisites`
- `course_offerings`
- `registration_windows`
- `registrations`
- `timetable_slots`
- `attendance_sessions`
- `attendance_records`
- `assessments`
- `marks`

### Finance simulation

- `fee_invoices`
- `payment_transactions`

### Support and governance

- `support_cases`
- `evidence_snapshots`
- `agent_runs`
- `agent_artifacts`
- `faculty_decisions`
- `support_plans`
- `replay_receipts`

### Integrity and operations

- `domain_events`
- `outbox_items`
- `audit_events`
- `command_receipts`
- `institution_revisions`
- `simulation_resets`

Academic, finance, decision, artifact, and audit history is append-only or
versioned. Later submissions create new versions and preserve the prior value.
Receipts are generated from successful payment transactions. Activity rails are
role-scoped projections of domain events rather than another mutable feed table.

### Concurrency rules

- Course capacity is checked while locking the offering row.
- One active registration per student and offering is enforced by a unique
  database constraint.
- Attendance, marks, and grants require the version the editor viewed;
  stale writes return a visible conflict instead of overwriting newer work.
- Payment, publication, decision, outbox, and reset commands use durable command
  receipts so retries return the original result.
- Faculty approval locks the case and verifies the current evidence vector and
  exact artifact hash inside the decision transaction.
- Ordinary commands take a shared advisory lock. Simulation reset takes the
  exclusive lock, rejects new commands, commits one complete seed generation,
  and only then reopens traffic.

## 11. Core API surface

The API uses REST-shaped resources and typed commands validated by Zod. Each
mutation requires an idempotency key and returns the emitted event ID.

```text
GET    /v1/me
GET    /v1/dashboard
GET    /v1/activity

GET    /v1/courses
POST   /v1/offerings/:id/publish
POST   /v1/offerings/:id/assign-faculty

GET    /v1/registrations
POST   /v1/registrations
POST   /v1/registrations/:id/withdraw

GET    /v1/classes/:id
POST   /v1/attendance-sessions/:id/submit

POST   /v1/assessments/:id/marks
POST   /v1/assessments/:id/publish

GET    /v1/people
GET    /v1/children/:id

GET    /v1/fees/invoices
POST   /v1/fees/invoices/:id/payment-attempts
GET    /v1/receipts/:id

GET    /v1/support/cases
POST   /v1/support/cases/:id/decisions
GET    /v1/support/plans

POST   /v1/governance/runs
POST   /v1/governance/outbox/drain
POST   /v1/governance/replays
POST   /v1/governance/exports
POST   /v1/governance/simulation/reset
```

Read endpoints return role-scoped projections, not database-shaped rows.

## 12. No-dead-button contract

Every interactive control receives a stable `data-action-id` registered in a
shared action manifest. The manifest declares:

- portal and route
- visible label
- actor roles
- action type: navigate, query, command, download, dialog, or local preference
- command or destination
- loading, success, empty, error, and disabled behavior
- audit event when the action mutates durable state
- automated test ID

Release checks fail on:

- `href="#"`
- empty click handlers
- buttons with no manifest entry
- enabled mutation buttons with no loading and failure state
- silent command failure
- controls visible to an unauthorized actor
- dialogs that cannot be completed or cancelled by keyboard
- downloads that do not produce a file

Disabled controls are allowed only when the current data state makes the action
invalid. The UI must display the exact reason, such as closed registration,
missing prerequisite, full capacity, unpublished marks, revoked parent field,
or stale support artifact.

## 13. Governed agent flow

```text
academic event committed
        |
        v
outbox item -> evidence freeze -> deterministic policy
                                   |
                    missing/stale/contradictory? -> DATA_BLOCKED
                                   |
                                   v
                         bounded cited composition
                                   |
                                   v
                          deterministic validation
                           |                 |
                      valid             one named repair
                           |                 |
                           +--------> valid or fallback
                                         |
                                         v
                              AWAITING_FACULTY
                                  |          |
                              approve      reject
                                  |
                                  v
                         published support plan
```

Replay reads stored evidence, policy, prompt, model output, validation, repair,
decision, and hashes. It creates one replay receipt and performs no other write.

## 14. Build sequence and commit gates

The system will be built as vertical slices. Each commit must leave the branch
buildable, deployable, and honest about what works. The Playwright journey is
extended after every slice; final hardening must not be the first integration
test.

### Commit 1: core, security, and deterministic seed

- Add the Core API workspace and seventh Vercel project
- Add the normalized schema, small CSE storyline, and minimal ECE denial fixture
- Add typed contracts, authorization, causal receipts, command idempotency,
  concurrency guards, serialized reset, and institution revision
- Add browser-security tests around the existing Better Auth clients

**Gate:** seed equality, reset serialization, cross-department denial, and Core
API contract tests pass.

### Commit 2: deployed five-portal walking skeleton

- Finish identity login, consent, demo persona selection, portal callbacks,
  local sessions, and sign-out
- Render one role-correct working shell per portal using the first typography,
  navigation, error, and activity-rail primitives
- HOD publishes and assigns the seeded offering through the real Core API
- Deploy all seven projects and run login plus `J01` in Playwright

**Gate:** five independent sessions work; wrong-role entry fails; the HOD event
is visible in every authorized destination; no rendered control is dead.

### Commit 3: registration slice

- Build the Student registration sheet with prerequisite, clash, capacity,
  register, and withdraw states
- Update Faculty roster, HOD enrolment, and causal receipts
- Refine the Student, Faculty, and HOD signature surfaces while implementing
  `J02`

**Gate:** `J01-J02`, duplicate command, full-capacity, prerequisite, and
cross-student denial tests pass on deployed previews.

### Commit 4: attendance and marks slice

- Build the Faculty classroom register and gradebook over seeded sessions and
  assessments
- Build Student academics and the Parent scoped child record
- Update HOD oversight and governance evidence projections
- Supersede any support artifact whose academic dependency changes

**Gate:** `J01-J05`, range validation, unassigned-faculty denial, revoked-grant,
stale-write, and propagation tests pass on deployed previews.

### Commit 5: parent fee slice

- Build synthetic invoice detail, successful and declined sandbox transactions,
  generated receipt download, and student/HOD balance projections
- Finish Parent visual states and duplicate-payment protection

**Gate:** `J01-J06` passes; retries create no duplicate payment or receipt.

### Commit 6: governed support and governance slice

- Port the bounded deterministic policy, composer, validation, one repair,
  fallback, outbox worker, and exact-artifact Faculty decision
- Build Governance run detail with evidence, validation, audit, replay, and one
  evidence download
- Publish role-scoped support consequences to Student, Parent, and HOD

**Gate:** `J01-J10`, data block, unsupported-output rejection, stale approval,
wrong-faculty denial, duplicate outbox delivery, and replay side-effect tests
pass on deployed previews.

### Commit 7: interaction and visual hardening

- Complete the institutional editorial visual language on every retained screen
- Verify every control against the action manifest
- Exercise loading, empty, conflict, network-error, and disabled-reason states
- Run keyboard, accessibility, responsive, console, and failed-request checks at
  390, 768, and 1440 pixels

**Gate:** zero dead controls, no critical accessibility issue, no visual
overflow, and no uncaught browser or network error.

### Commit 8: release evidence

- Run the complete journey for three consecutive clean resets
- Promote the tested commit to all seven production projects
- Capture screenshots, interaction evidence, test output, schema and seed
  versions, commit SHA, URL inventory, limitations, and live-model status

**Gate:** the acceptance matrix is green and the evidence describes only what
was actually exercised.

## 15. Verification strategy

### Static and unit

- TypeScript strict mode
- ESLint and formatting
- Zod contract tests
- Policy, prerequisite, capacity, timetable, payment, and grant rules
- Action-manifest coverage

### Database and service integration

- Real PostgreSQL test schema
- Transaction rollback and idempotency tests
- Version and stale-write conflicts
- Immutable audit and artifact guards
- Department, assignment, relationship, and field-grant denials

### Cross-portal end to end

1. Reset seed.
2. Sign into all five portals.
3. HOD publishes offering and assigns faculty.
4. Student registers.
5. Faculty observes roster, submits attendance, and publishes marks.
6. Student and parent observe permitted changes.
7. Parent completes a sandbox payment and downloads the receipt.
8. Governance drains the event queue and inspects the generated artifact.
9. Faculty approves the exact artifact.
10. Student and permitted parent observe the support plan.
11. HOD observes disposition.
12. Governance replays and verifies zero side effects.

### Visual and interaction quality

- Screenshot review for every major route at 390, 768, and 1440 pixels
- No horizontal overflow
- No text truncation that hides meaning
- No generic placeholder copy or repeated fake metrics
- Consistent focus, hover, pressed, loading, success, and error states
- Tables remain usable on mobile through deliberate list transformations
- Charts always have accessible tabular equivalents

## 16. Release definition of done

The ecosystem is complete only when:

- all five portals are visually distinct and recognizably part of AURA
- all planned routes render real seeded data
- every rendered control satisfies the action manifest
- all mutations persist through the Core API and create audit history
- cross-portal consequences appear within 15 seconds in a visible tab or
  immediately after manual refresh
- every role and denial path is enforced server-side
- the frozen end-to-end journey passes three consecutive clean resets
- deterministic fallback completes the support workflow without a model key
- live-model execution is labeled unverified until actually exercised
- desktop and mobile deployed URLs have been visually inspected
- the evidence package matches the deployed commit

If one of these conditions fails, the release is not called a complete working
ecosystem.

## 17. Revisit triggers

Only revisit the architecture if the project gains real institutional data,
multiple universities, a real payment provider, external messaging authority,
or evidence that the single Core API can no longer satisfy measured load. None
of those conditions exists for the synthetic capstone.
