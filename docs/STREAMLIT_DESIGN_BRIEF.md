# Brief 17: Make the Streamlit app visually distinctive

13 October 2026. The owner's verdict on the current UI: "bland". The deployed Streamlit app is what examiners see,
so presentation quality now matters as much as features. This brief is **presentation only**. Don't change
behaviour, permissions, scoping, validation or data. Every existing test and guardrail must still pass.

## What's wrong now (from `runtime/streamlit-project/cloud-*.png`)

- The sidebar navigation is `st.sidebar.radio` (app.py ~2504). It reads as a form, not an app. The email shows
  as an underlined link, and the identity block is plain text.
- Internal values leak into the UI:
  - status enums like `awaiting_faculty`;
  - full UUIDs ("Current version: 30f05fcd-…");
  - "Revision: 0" / "Revision: 1";
  - truncated run hashes in tables;
  - raw file names like `Full_Attendance_Report(6) (1).xls`.
- There is no hierarchy:
  - every page is a vertical stack of selectboxes, plain dataframes and bare `st.metric` numbers;
  - there are no cards, icons, badges, charts or empty states;
  - large parts of wide screens are empty.
- Repeated `st.info` boxes ("Not defined in the supplied records…") look like errors.
- The login page is a bare form with a workspace dropdown and no brand presence.
- The theme (`.streamlit/config.toml`) only sets five colours and "sans serif".

## Design direction: the lab manual's node-graph legend as the visual language

Chapter 11 colour-codes the system:

- navy = AURA Coordinator;
- light blue = specialist agents;
- amber = human review gate;
- green = governed publish.

Use exactly this as the app's semantic palette, so every screen visibly expresses the architecture examiners are
grading:

- AI and coordinator surfaces are navy.
- Agent and specialist outputs are light blue.
- Anything waiting on a human decision is amber, with a gate icon.
- Approved or published items are green.

The direction overall should be calm, confident and editorial, with evidence-led density done beautifully. It
should not look like a generic SaaS template.

### Tokens

Starting values; tune for contrast.

| Token | Light | Use |
|---|---|---|
| canvas | `#F6F4EF` (warm paper) | page background |
| surface | `#FFFFFF` | cards |
| ink | `#14213D` | primary text |
| ink-soft | `#4A5568` | secondary text |
| line | `#E2DED5` | borders and dividers |
| coordinator / navy | `#1B2A4A` | sidebar, AI and coordinator elements, primary buttons |
| specialist / blue | `#2F6FB0`, tint `#E7F0F9` | agent output, citations, info |
| gate / amber | `#B7791F`, tint `#FBF1DE` | awaiting human decision, gate banners |
| publish / green | `#1F7A4D`, tint `#E4F3EA` | approved, published, success |
| danger | `#B42318`, tint `#FCEBE9` | errors, high risk |

- **Risk bands (low, medium, high)** need their own colourblind-safe set that can't be confused with the gate amber.
  Always pair colour with a text label and an icon, never colour alone.
- **Validate contrast:** WCAG AA for all text and UI elements.
- **Typography:**
  - Headings in a characterful serif (for example Fraunces or Source Serif 4, weight 600).
  - Body and UI in IBM Plex Sans (continuity with the earlier AURA DESIGN.md).
  - Tabular numerals for all figures.
  - Load fonts with Streamlit's theme font-face support (vendored files served statically, or Google Fonts);
    both cost nothing.
- **Shape:** 12px card radius, 8px controls, soft single-layer shadows, generous spacing (8px scale).
- **Optional:** a dark theme, if Streamlit 1.63 supports separate light/dark theme sections cleanly.

## Global changes

1. **Theme in `config.toml`.** Set the full token set: fonts and font faces, base radius, border colour, link
   colour, chart categorical and sequential colours, sidebar theme. Set `client.toolbarMode = "minimal"`. Verify
   each option against the installed Streamlit 1.63 docs. Keep the root and `streamlit_app/` configs identical.
2. **Navigation.** Replace the radio with `st.navigation` / `st.Page`, using Material icons and grouped sections
   per role (or top navigation, if that reads better). Use `st.logo` with an AURA wordmark (simple SVG made in-repo).
3. **Identity card at the top of the sidebar:** initials avatar, name, a role badge in its semantic colour, and the
   email as plain muted text. Make Sign out a quiet secondary button at the bottom.
4. **A small component module, `streamlit_app/ui.py`,** used everywhere:
   - `page_header(title, subtitle, icon)`;
   - `kpi_row([...])`: bordered metric tiles with optional delta and sparkline;
   - `status_badge(status)`: one map from every internal enum to a human label, colour and icon;
   - `risk_badge(band, score)`;
   - `gate_banner(text)`;
   - `card(...)`;
   - `empty_state(icon, title, hint)`;
   - `citation_chip(path, value, threshold)`;
   - `pipeline_stepper(node_states)`;
   - `tech_details(expander)` for IDs and hashes.
5. **Human language everywhere.** Map every enum to plain English:
   - `awaiting_faculty` → "Awaiting your review";
   - `needs_human` → "Needs your decision";
   - and so on.
   - Format dates ("9 Oct, 10:23").
   - Hide UUIDs, revisions and hashes inside a collapsed "Technical details" expander. Keep them available for audit.
   - Show friendly source names, with the original file name as a tooltip or detail.
6. **Callouts.** Merge repeated "Not defined…" notes into one subtle, collapsible "About these records" note.
   Use `st.info`/`st.warning` only when something actually needs attention.
7. **Feedback:** `st.toast` on successful saves, `st.status` for review runs (with visible per-node progress),
   friendly copy in spinners.
8. **Layout:** use columns and bordered containers to fill wide screens sensibly. Every page must work at 375px.
9. **Charts:** Altair (bundled with Streamlit) with the token palette, consistent axis styling, aggregate-only on
   the HoD pages. Follow good data-viz practice: direct labels where possible, no chart junk.

## Per-workspace treatment

- **Login.** A split layout:
  - Left: a navy brand panel with the wordmark, a one-line promise ("Early support. Mentor decides."), and a quiet
    illustration of the coordinator → agents → human gate → publish flow in the legend colours.
  - Right: the sign-in card.
  - Replace the workspace dropdown with six icon tiles or segmented control (Student, Parent, Mentor, HoD, LMS,
    AI Activity).
- **Mentor.**
  - **Overview:** greeting, KPI tiles (flagged, awaiting your review, approved this cycle, overdue follow-ups) and
    a "Needs you today" list.
  - **Support reviews:** a review queue of student cards, each with a risk badge and score bar, the top 2–3 signals
    as chips, a status badge, and one clear primary action.
  - **Draft view, two columns:**
    - Left: the draft (rationale with citation chips, actions with talking points).
    - Right: the evidence panel and the validation checklist with ticks.
    - Above both: an amber "Human gate" banner.
    - Approve (green), Edit and Override as clear, distinct buttons.
  - **Agent pipeline:** a horizontal stepper using the legend colours (Coordinator → 4 collectors → Risk →
    Retrieval → Recommendation → Validation → Human gate → Publish), with per-node state from the Brief 9 graph trace.
- **HoD:**
  - a dashboard with KPI tiles;
  - a risk-trend line chart;
  - a band-distribution stacked bar;
  - an intervention-outcome funnel or bars per cycle.
  - Aggregate only.
- **AI Activity:**
  - a run timeline;
  - metrics tiles (validation pass rate, repairs, fallbacks, model vs rules, provider used);
  - the node graph visualised with node states;
  - the agent trace (tool calls, candidates and scores, diagnoses) as readable cards, not raw JSON.
- **Student and Parent:**
  - calm and encouraging, never alarming, no jargon, no risk labels shown to students;
  - attendance and marks as progress bars against the expected level;
  - "Your support plan" as a friendly card with the approved actions and the mentor's name;
  - receipts as clean cards with a download.
- **LMS:**
  - course cards;
  - a lesson list with icons;
  - assignment badges (overdue red, due soon amber, submitted green);
  - submission status and feedback as cards.
- **Source records:**
  - a polished table using `column_config` (formatted numbers, NA and blank shown as a muted "—" with a tooltip);
  - a filter bar;
  - one "About these records" note.

## Constraints

- **Security:** if you inject CSS or HTML (`st.html`, or markdown with HTML), **escape every dynamic value**:
  names, course titles, notes and source values are untrusted. No script injection. Keep scope checks untouched.
  Students and parents must never see risk scores, bands or other students.
- **₹0:** no paid component libraries. Only free fonts. Prefer built-in Streamlit primitives over custom HTML;
  use custom CSS sparingly and scope it to stable class names. Keep custom-CSS dependence on Streamlit's internal
  DOM to a minimum.
- **Tests:** keep all Core tests and the Streamlit AppTest checks green. Where a test asserts old labels, update
  the assertion to the new human label in the same commit.
- **Accessibility:** AA contrast, visible focus states, icon plus text (never icon alone), and motion that
  respects reduced-motion settings.
- **Sequencing:** do this right after the Briefs 1–9 redeploy and **before** Briefs 11–16. Then the new agentic
  panels (trace, citations, candidates, diagnoses) are built from `ui.py` components from the start, rather than
  restyled later.

## Verification and evidence

- Capture before and after screenshots of every workspace page at 1440px and 375px wide, using fictional or
  Student 021 test accounts only. Save them to `runtime/streamlit-project/design/before|after/`.
- Run a contrast check on the token palette and on key screens. Record the results.
- Run the full local acceptance (six logins, 21 pages), then redeploy and capture the hosted after-shots.
- Report the changes per workspace, which `ui.py` components exist, and any Streamlit limitation that forced a
  compromise.

## Delegation suggestion for the orchestrator

- **Astra:** owns the design direction, the token decisions, the `ui.py` API and the final visual review.
- **gpt-6.1-sol:** implements `ui.py`, the navigation and the per-workspace layouts.
- **gpt-6-luna:** screenshot capture, the contrast checks, the enum-to-label map and test assertion updates.

`app.py` is one file, so sequence the edits or split pages into modules first. Never let two agents edit the same
file at once.
