# AURA design system: "Signal"

Art direction: calm intelligence. An editorial data-journalism look (FT and Pentagram data stories) crossed with premium product UI (Linear, Vercel). Quiet paper, ink and one signal colour: the interface stays calm until something needs a human.

Everything here is presentation only. Implementation lives in `streamlit_app/ui.py` (tokens, CSS, components), `.streamlit/config.toml` and `streamlit_app/.streamlit/config.toml` (theme, kept identical) and `streamlit_app/labels.py` (user-facing wording). Behaviour, data and the Core are untouched.

## Tokens

CSS custom properties are defined once in `ui.CSS` (`:root`) and mirrored in the theme config.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F4F1EA` | page background |
| `--surface` | `#FBFAF6` | cards, inputs, expanders |
| `--ink` | `#0E1116` | text, sidebar, secondary buttons |
| `--ink-2` | `#3A3F47` | secondary text, active sidebar fill |
| `--ink-3` | `#5B6068` | captions (5.7:1 on paper) |
| `--hairline` / `--hairline-2` | `#E2DDD2` / `#D3CDBF` | 1px rules and borders |
| `--signal` | `#FF5A1F` | primary CTA and the "needs you" state (ink text on it: 6.1:1) |
| `--signal-ink` | `#B8360A` | signal as text on paper (4.8:1) |
| `--agent` | `#2B59FF` | anything an AI did (`--agent-ink` `#1F3FBF` for text, `--agent-on-ink` `#8BA3FF` on the dark panels) |
| `--low` / `--medium` / `--high` | `#2F9E6F` / `#E5A200` / `#E5484D` | risk bands |

Theme mapping (Streamlit badge tones are reused rather than renamed): blue = agent, orange = needs a human (signal), green = low risk or done, violet = medium risk (amber), red = high risk or failed, gray = neutral. `primaryColor` is ink so selection states stay calm; the single vermilion element in a view is its primary button.

Spacing is an 8px scale (`--s1` 8 to `--s12` 96). Cards use a 16px radius, controls 12px, buttons are pills. Page content is capped at 1240px.

## Type scale

Fonts load through the theme's Google font URLs (Instrument Serif, Geist, Geist Mono).

| Role | Face | Size |
| --- | --- | --- |
| Page title (h1) | Instrument Serif, one italic word | `clamp(36px, 5.4vw, 60px)`, tracking -0.025em |
| Section (h3) | Instrument Serif | 28px (24px on phones) |
| Decision title | Instrument Serif | 40px (32px on phones) |
| Body and UI | Geist | 15px, 1.55 line height |
| Subtitle | Geist | 17px, max 62ch |
| KPI numeral | Geist 500, tabular, tracking -0.045em | up to 52px, sized to the value (`cqi`) |
| Labels, eyebrows | Geist / Geist Mono | 11 to 12px, uppercase, +0.08em to +0.14em |
| Data, IDs, hashes | Geist Mono | 11 to 13px, tabular figures |

## Components (`ui.py`)

- `page_header(title, subtitle, eyebrow, em)`: mono role eyebrow, serif title with one italic word (the last word unless `em` is given), one-line subtitle, hairline.
- `section(title, caption)`: serif h3 plus caption. `card(key)`: keyed bordered container (`.st-key-card_*`), hairline, no shadow, lifts 2px on hover (not when it holds a form or table).
- `kpi_row(items)`: wrapped in `.st-key-kpis_*`; two-up on phones. `signal: True` turns a card vermilion with a pulsing dot while its value is above zero. Numerals in a row share a size set by the longest figure; labels wrap, values never clip.
- `gate_banner(text, title)` and `decision_head(version, hash)`: the mentor gate. A vermilion left rule, a pulsing "Awaiting your decision" eyebrow, a serif "Your decision" heading, the exact version and the full content hash in mono. The container key `gate_decision` is the CSS hook.
- `agent_chip(model)` / `agent_chip_block(...)`: small cobalt "agent" chip with the model name. Used on draft cards, the draft recommendation, the family support plan and planner questions.
- `pipeline_stepper(trace)`: a connecting line that draws, nodes that light cobalt as they complete, vermilion pulse for a node waiting on a person. Nine nodes fit at 1280px; below 640px it becomes a vertical timeline.
- `empty_state`, `insight` (why something is not shown), `group_heading` (alphabetical groups), `citation_chips`, `claim_chips`, `signal_chips`, `tech_details`.
- `brand_panel()` and `login_view()`: split-screen sign-in. Ink hero with the serif promise, an SVG signal line that draws itself and ends in one vermilion dot, and the agent flow in mono; the form on paper. On phones the hero collapses to a slim band and the form comes first.
- `style_chart(chart)`: Altair look (surface background, hairline grid, ink axes, mono tick labels, risk-band colours). The element toolbar is hidden on charts so it cannot overlap a title.
- Icons are Material only. SVG graphics travel as data-URI images because `st.html` strips inline `<svg>`.

## Motion (CSS only, honours `prefers-reduced-motion`)

- Cards, KPIs and blocks fade up 12px in 380ms with `nth-child` stagger (40ms steps, last at 320ms). Fill mode is `backwards`, so a finished animation never fights Streamlit's stale-element opacity.
- Tabs: a 2px ink underline draws in from the left (320ms); hover shows a faint ghost of it.
- Sidebar: the 3px vermilion bar scales in on the active item.
- Pulsing vermilion dot for "awaiting your decision" (1.9s ring, the only looping motion besides the sign-in dot).
- Pipeline stepper: line draws in 900ms, nodes light with a 70ms stagger.
- Sign-in: the signal line draws over 2.4s once, then the vermilion dot appears.
- Easing is `cubic-bezier(.22,.8,.2,1)`; only `transform` and `opacity` animate. Under reduced motion every animation and transition is removed and the signal line is swapped for a static copy.

## Layout rules

- Hairline 1px rules instead of heavy boxes; generous whitespace; forms keep an 860px measure.
- Mobile: sidebar collapsed by default (`initial_sidebar_state="auto"`), content first, KPIs two-up, hero collapsed, pipeline vertical.
- Tables stay `st.dataframe` (verify scripts read them). Column widths are computed from the header and longest value so cells do not clip, and `None` shows as a dash.

## Display wording

Names are Title Case for display only (`labels.pretty_name`, applied in `display_name()` and every name cell); stored data is unchanged. Draft versions count from 1 (`labels.version_number`). Signal reasons, family summaries and tool names read as words (`labels.readable_claim`, `family_summary`, `tool_label`). There are no emoji.

## Rubric (Awwwards weights: design 40%, usability 30%, creativity 20%, content 10%)

Scored against screenshots from `walk.py --pass design1` and `--pass design2` (desktop 1280x900 and mobile 390x844).

| Criterion | Round 1 | Round 2 |
| --- | --- | --- |
| Design (40%) | 7.5 | 8.0 |
| Usability (30%) | 7.0 | 8.0 |
| Creativity (20%) | 7.5 | 8.0 |
| Content (10%) | 7.5 | 8.0 |
| Weighted | 7.35 | 8.00 |

**Three weakest spots after round 1 (and what was done)**

1. Data surfaces sat outside the system: tables clipped headers and long cells, the five-up KPI row broke labels mid-word ("RECORDE D RUNS"), multi-select tags were heavy black pills, and mixed numerals in one KPI row had different sizes. Fixed with computed column widths, wrap-safe labels with a compact five-up variant, hairline tags and one numeral size per row.
2. Empty and degenerate data looked broken: the department charts drew bars of height 1 and an empty line, and the pipeline stepper repeated "No traced run yet" ten times. Fixed with an honest "too small to chart yet" note plus a table, consistent cycle names (C1, C2) in charts and tables, and a stepper that shows no state text when there is no run.
3. Long lists could not be scanned: 53 flagged-student expanders, 107 to 321 source expanders, and plan or draft selectors that all read alike. Fixed with a cap and toggle, search, alphabetical grouping and a jump control, and selector labels that carry register number, risk, date and reference.

**Three weakest spots after round 2 (open, with the reason)**

1. `st.dataframe` grids are Streamlit canvas tables: they take the theme's colours and fonts but not the CSS system, and cell text longer than its column still ends in an ellipsis (hover or click shows it). The verify scripts read these tables, so they were kept rather than replaced with HTML tables.
2. Long form pages (review plans, policies, follow-ups) follow the system but are still plain stacks of fields, with less editorial hierarchy than the overview and gate pages.
3. Motion and the sign-in animation were checked by computed styles and reduced-motion captures, not by recorded video, and the tab bars on a phone scroll sideways (with a native cue) instead of wrapping.

Round 2 evidence: `walk.py --pass design2` (9 sessions, 233 views, 0 Streamlit exceptions, 0 horizontal overflow, 0 truncated views, down from the clipped values logged in #17 and #23; nine phone landings with the sidebar closed).

## Checks

Every `streamlit_app/verify_*.py` except `verify_local.py` and `verify_cloud.py` passes (`verify_chapter11_trends.py` now asserts two charts only when the cycles carry information, none otherwise). Walks write screenshots to `runtime/streamlit-project/e2e/pass<label>/` (git-ignored).
