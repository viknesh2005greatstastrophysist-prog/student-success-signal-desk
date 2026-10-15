# AURA design system

Art direction: clear, quiet, Apple-like. A student-success tool should feel like Settings or Health on an iPhone or Mac: the interface recedes and the content leads. This replaces the earlier "Signal" look (serif display, vermilion, cobalt chips, dark sidebar), which was rejected as generic.

Four principles, applied to every screen:

1. **Clarity.** One title, one primary action, few elements. If a person has to scan, there is too much.
2. **Deference.** Chrome is white, grey and hairline. Colour appears only where it means something.
3. **Depth through layering.** A white surface on a `#F5F5F7` page, a soft two-part shadow, and nothing heavier. Sheets and cards lift 1 px on hover; nothing bounces.
4. **Consistency.** One type family, one accent, one card radius, one list pattern.

Everything here is presentation only. Implementation lives in `streamlit_app/ui.py` (tokens, CSS, components), `.streamlit/config.toml` and `streamlit_app/.streamlit/config.toml` (theme, kept identical) and `streamlit_app/labels.py` (wording). Behaviour, data and the Core are untouched.

## Tokens

CSS custom properties are defined once in `ui.CSS` (`:root`) and mirrored in the theme config.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F5F5F7` | page background |
| `--surface` | `#FFFFFF` | cards, sheets, lists, inputs |
| `--fill` / `--fill-hover` | `#E8E8ED` / `#DEDEE3` | secondary buttons, the active sidebar row, segmented tracks |
| `--text` | `#1D1D1F` | primary text |
| `--text-2` | `#6E6E73` | secondary text, captions (5:1 on white) |
| `--text-3` | `#86868B` | tertiary: version and hash lines, notes (not for sentences people must read) |
| `--sep` / `--hair` | `rgba(0,0,0,.08)` / `rgba(0,0,0,.06)` | separators, card hairlines |
| `--blue` | `#0071E3` | **the one accent**: primary buttons, links, the active state, one chart series |
| `--green` `--orange` `--red` | `#34C759` `#FF9F0A` `#FF3B30` | status dots only |
| `--green-text` `--orange-text` `--red-text` | `#1F8A3B` `#A35F00` `#D70015` | the same statuses as words on white (4.5:1 or better) |

The Streamlit tone names reuse these: blue is in progress, green is fine or done, orange and violet are attention (medium risk, needs a person), red is urgent or failed, gray is neutral. `primaryColor` is the blue, so selection states stay on-system. `backgroundColor` in the theme is white on purpose (Streamlit paints table cells, menus and popovers with it, and those are surfaces); the page itself is painted `--bg` by the CSS.

Radius: cards and lists 18 px, sheets 24 px, inner grouped lists 14 px, fields 12 px, buttons and segmented thumbs are pills (980 px or 8 px inside a 10 px track). Shadow: `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04)`; the sheet adds a deeper pair. Spacing follows an 8 px scale; the page is capped at 1040 px with 64 px top and 48 px side padding (16 px on phones).

## Type

One family: **Inter**, the closest free stand-in for SF Pro, loaded from the theme's Google font URL. No serif. No monospace anywhere except IDs and hashes inside technical details. Sentence case everywhere; no all-caps tracked labels. Numerals are tabular.

| Role | Size and weight | Where |
| --- | --- | --- |
| Large title | 36 px, 600, tracking -0.022em (30 px on phones) | the page title (`ui.page_header`) |
| Title | 24 to 28 px, 600 | section titles (`ui.section`), the feature name, the sheet title |
| Headline | 19 px, 600 | "Why this draft", list headings |
| Body | 17 px, 400, line height 1.47 | paragraphs, list titles (500), buttons |
| Secondary | 15 px, `--text-2` | list subtitles, status words, labels, section captions |
| Caption | 13 px, `--text-2` | notes, provenance, the sidebar role |

## Components (`ui.py`)

- `page_header(title, subtitle)`: the large title and one secondary line. No eyebrow, no rule. (`eyebrow` and `em` are accepted and ignored so old calls keep working.)
- `section(title, caption)`: a 24 px title and a 15 px caption.
- `card(key)`: a keyed white container (`.st-key-card_*`), 28 px padding, hairline, soft shadow, lifts 1 px on hover (not when it holds a form, table or button).
- `kpi_row(items)`: the figures, in **one** white card divided by hairlines: label above, 34 px number below. Two-up on phones. `kpi_row_nonzero` leaves a zero out. `icon` and `signal` are ignored.
- `feature_card(key, kicker, title, text, status, meta, action)`: the single most important thing on a screen. Returns True when its primary button is pressed.
- `inset_list(rows)`: the read-only iOS inset grouped list: hairline-separated rows in one rounded card. A row is `title`, `sub` (two lines at most), `status` (a label and tone), `end` and an optional `bar` (0 to 100). `flat=True` makes the grey, shadowless version for use inside a card or sheet.
- `row_list(key, rows)`: the same list with a chevron, where the whole row is one tap target (an invisible button covers it). Returns the tapped index.
- `detail_list(pairs)`: label and value rows (profiles, receipts).
- `status_html(label, tone)` and the badge helpers (`status_md`, `risk_md`, `badge_md`): **a small dot and a word**, never a filled chip. Streamlit's badge element is restyled to the same look.
- `provenance_caption()`: "Drafted by AI · checked by your mentor" with a small sparkle in secondary grey. The model name, the checks and the trace live behind "How this was made". `agent_chip`, `agent_chip_block` and `judge_chip_block` now render this quiet line.
- `claim_chips`, `citation_chips`: evidence as grouped label and value rows, not chips. `signal_chips`: plain secondary words.
- `gate_banner`, `insight`, `empty_state`: white notice cards with a small dot or none. No dashed borders.
- `sheet_header`, `sheet_heading`, `sheet_paragraph`, `decision_head`: the parts of the mentor sheet (below).
- `pipeline_stepper(trace)`: a quiet horizontal stepper. Done is a dark filled node, running is a blue ring, waiting a person is an orange ring, failed is red. It turns into a vertical timeline on phones.
- `style_chart(chart)`: Altair, minimal (below).
- Icons are Material only (rounded, light weight). SVG graphics travel as data-URI images because `st.html` strips inline `<svg>`.

### Sidebar

Light frosted glass: `rgba(255,255,255,.72)` with `backdrop-filter: saturate(180%) blur(20px)` and a hairline right edge. The brand sits at the top, the plain-text navigation rows follow, and the signed-in person and a quiet Sign out sit at the bottom (the order is set with CSS `order`, because Streamlit renders its navigation above custom sidebar content). The active row is a `#E8E8ED` pill with semibold text.

### Controls

Primary: a blue pill (radius 980 px, 17 px text, 12 by 22 px padding). Secondary: a `#E8E8ED` pill. Tertiary: blue text. **Destructive: red text**, by giving a button a key that starts with `danger`. Segmented controls are iOS style: a grey track, a white raised thumb, 15 px labels (wrapped into a 3 by 2 grid on the sign-in card). Fields are white, 12 px radius, with a 4 px blue focus ring. Tables stay `st.dataframe` (hairline rows, no zebra striping, right-aligned numbers, 44 px rows) because the verify scripts read them.

### Signature screens

- **Sign-in.** A centred white card on `#F5F5F7`: the mark, "AURA", "Every student, seen early.", the workspace as a segmented control, large rounded fields, a blue Continue. On a phone the card is the whole screen. Email and password survive switching workspace (the control lives inside the form). Below the password: a "Keep me signed in on this device" checkbox (on). When this browser remembers a workspace, a caption "Continue where you left off" and one secondary button per workspace sit above the form. On a local machine only, a quiet "Test accounts" card follows the sign-in card: an uppercase 12 px title, a grey caption, 38 px secondary buttons in three columns with 13 px labels.
- **Mentor, Today.** A large title and a greeting. One "Next decision" card for the most urgent student: name, a two-line reason, status, a blue Review button. Then an inset list of the rest (name, reason, status, chevron), then a second quiet list for check-ins and follow-ups. There is no grid of tiles. Review opens Reviews with that student's draft already chosen.
- **Review, the sheet.** "Approve this plan?", the plan in plain language with its evidence, then **Approve and publish** (blue), **Edit** (secondary) and **Decline** (red text) under one required reason. Version and a short hash sit below in small tertiary text; the full hash is under Technical details. The model, the checks that ran and the trace are behind "How this was made".
- **Student and parent overview.** A large greeting title, three figures at most (attendance this term, results published or the fee balance, support plan status), the courses as one inset list with a thin attendance bar, then the support plan as readable text.

### Charts

Altair. White background, faint horizontal guides only (`rgba(0,0,0,.07)`), no axis lines or ticks, 12 px Inter labels in `#6E6E73`, one accent series (`#0071E3`), grey for the rest, status colours only for risk bands. The toolbar is hidden so it cannot cover a title. **Show a chart only when it says something**: the department trend shows a plain "Too small to chart yet" note instead of a flat line.

## Motion

CSS only, honours `prefers-reduced-motion` (every transition and animation is removed).

- Content fades in over 250 ms, ease-out, with no stagger and no movement.
- Hover on cards, rows and buttons: 200 ms ease-out, a 1 px lift and a soft shadow. Press scales to .98.
- Nothing loops. Nothing bounces. There is no pulse and no draw-in.

## Rules for what not to show

- **Every number must earn its place.** Delete a tile that shows a trivial value ("Students in scope 1", "Courses 3", "Source files 1", a count of zero). Two or three figures per screen at most; zeros are left out.
- **One primary action per screen.** One blue pill. Everything else is secondary or text.
- **Status is a dot and a word.** No filled chips, no coloured panels, no emoji.
- **AI provenance is a caption**, not a badge. Model names and traces sit behind "How this was made".
- **No decoration.** No gradients, no pulsing dots, no mono eyebrows, no dashed borders, no serif.
- **Technical strings stay out of the way**: IDs, hashes and references are in Technical details, small and tertiary.
- Parents never see risk scores or labels; students never see fees or source records (unchanged rules).

## Display wording

Names are Title Case for display only (`labels.pretty_name`); the stored data is unchanged. Draft versions count from 1. Signal reasons, family summaries and tool names read as words. Long decimals in evidence are rounded for display. Greetings use the college's time zone (Asia/Kolkata).

## Rubric

Scored 1 to 10 against `walk.py` screenshots (desktop 1280 by 900 and mobile 390 by 844). Apple HIG fidelity covers clarity, deference and restraint. Awwwards covers design, usability, creativity and content. "AI-slop tells" is scored so that **higher is cleaner**: 10 means no generic tiles, chip clutter, decorative gradients, random emoji or inconsistent spacing.

Means over twelve screens (sign-in desktop and phone, mentor Today desktop and phone, the review sheet, student overview desktop and phone, parent overview phone, department overview, runs, agent graph, learning). Round 1 is `walk.py --pass apple1`, round 2 `apple2`, round 3 `apple4` plus a spot check of Runs after the last wording change.

| Rubric line | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| Apple HIG fidelity (clarity, deference, restraint) | 7.8 | 8.4 | 8.8 |
| Awwwards (design, usability, creativity, content) | 7.5 | 7.8 | 8.2 |
| AI-slop tells (10 = none) | 8.4 | 9.0 | 9.6 |

Round 3 by screen (HIG, Awwwards, slop-free): sign-in desktop 9, 9, 10; sign-in phone 9, 8, 10; Today desktop 9, 9, 10; Today phone 9, 8, 10; review sheet 9, 8, 9; student overview desktop 9, 8, 10; student overview phone 9, 8, 10; parent overview phone 9, 8, 10; department overview 8, 8, 9; runs 8, 8, 9; agent graph 9, 8, 9; learning 8, 8, 9. Every line is at least 8 and no screen scores below 8.

**Round 1 weakest spots (and what was done)**

1. Agent graph (HIG 6): step names collided, the page title repeated as a section title, and the run picker was labelled "Search show node activity for run". Fixed with a smaller no-break step label, one title, and a "Run" picker.
2. Tables clipped and form fields vanished: inputs took the theme's grey and sat invisibly on the grey page, and policy and evaluation tables scrolled sideways. Fixed by painting fields white (Streamlit 1.63 uses `stTextInputRootElement`, not the old baseweb hook), a short grouped policy list with the full table behind a row, and fewer columns in the evaluation table.
3. Figures that said nothing and icon clutter: Learning showed "Still open 0, Your submissions 1", every expander and caption carried a Material icon, and the parent overview's headline balance counted a voided invoice. Fixed by deleting those tiles, hiding decorative icons (and drawing one chevron per disclosure), and excluding voided invoices.

**Round 2 weakest spots**

1. Streamlit gives headings a negative bottom margin that the old CSS had hidden; with it neutralised, titles, subtitles and controls now breathe consistently.
2. Phone details: the sign-in workspace control truncated "Department head" (now a two-column grid), a long rupee figure wrapped (whole rupees in headline figures), the stepper split "Recommendation".
3. Wording that did not fit a column: "Superseded by data refresh" is now "Replaced by new data".

**Open (honest)**

- Wide `st.dataframe` grids are canvas tables: they take the theme's colours, fonts and 44 px rows but not the CSS, and a cell longer than its column can still end in an ellipsis in a few dense tables (the cohort risk table's Status column).
- Creativity is deliberately restrained. The memorable moments are the sign-in card, the single Next decision card and the approve sheet; everything else is quiet on purpose.
- Motion was checked by computed styles and reduced-motion rules, not by recorded video.
- The risk labels in the review draft picker and on Today now use the same latest-row rule (the picker used to show an older cycle's band).


## Checks

Every `streamlit_app/verify_*.py` except `verify_local.py` and `verify_cloud.py` passes. The read-only walk (`walk.py --pass apple1`, `--pass apple2`) reports 0 Streamlit exceptions. Walks write screenshots to `runtime/streamlit-project/e2e/pass<label>/` (git-ignored).
