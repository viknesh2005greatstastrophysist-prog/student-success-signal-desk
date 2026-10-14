"""AURA visual components.

Presentation only. Every dynamic value that reaches custom HTML passes through
``esc``; tones, roles and icons come from fixed allowlists, never from records.
Native Streamlit elements are preferred wherever they can express the design.
"""

from __future__ import annotations

import html
from collections.abc import Iterable, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import labels
import streamlit as st

ASSETS = Path(__file__).resolve().parent / "assets"
TONES = {"blue", "green", "orange", "red", "violet", "gray", "primary"}
NODE_ROLES = {"coordinator", "agent", "gate", "publish"}
STATE_TONES = {"green", "blue", "orange", "red", "gray"}

CSS = """
<style>
:root {
  --aura-canvas: #F6F4EF; --aura-surface: #FFFFFF; --aura-ink: #14213D;
  --aura-ink-soft: #4A5568; --aura-line: #E2DED5; --aura-navy: #1B2A4A;
  --aura-blue: #2F6FB0; --aura-blue-tint: #E7F0F9; --aura-amber: #B7791F;
  --aura-amber-ink: #7A4F0A; --aura-amber-tint: #FBF1DE; --aura-green: #1F7A4D;
  --aura-green-tint: #E4F3EA; --aura-red: #B42318; --aura-red-tint: #FCEBE9;
  --aura-gold: #F2C46D;
  --aura-shadow: 0 1px 2px rgba(20,33,61,.05), 0 6px 18px rgba(20,33,61,.06);
}
[data-testid="stMainBlockContainer"] { max-width: 1240px; padding-top: 2.4rem; padding-bottom: 4rem; }
h1, h2, h3, h4 { font-family: "Source Serif 4", "Source Serif", Georgia, serif; }
h1 { letter-spacing: -0.02em; }
h2, h3 { letter-spacing: -0.01em; }
h5, h6 { letter-spacing: .01em; }
[data-testid="stMetricValue"], [data-testid="stDataFrame"], .aura-num { font-variant-numeric: tabular-nums; }

/* Cards: keyed bordered containers get a white surface and a soft lift. */
[class*="st-key-card_"] { background: var(--aura-surface); box-shadow: var(--aura-shadow); }
[class*="st-key-card_"] [data-testid="stMetric"] { box-shadow: none; }
[data-testid="stMetric"] { background: var(--aura-surface); box-shadow: var(--aura-shadow); }
[data-testid="stExpander"] details { background: var(--aura-surface); }
[data-testid="stForm"] { background: transparent; }

[class*="st-key-gate_"] { background: #FFFBF3; border-color: #EBD3A6 !important;
  border-left: 5px solid var(--aura-amber) !important; box-shadow: var(--aura-shadow); }
[class*="st-key-card_"] [data-testid="stForm"], [class*="st-key-gate_"] [data-testid="stForm"] {
  background: transparent; box-shadow: none; }

/* Sidebar navigation: the role-scoped radio reads as an app rail. */
[data-testid="stSidebar"] [data-testid="stRadio"],
[data-testid="stSidebar"] [data-testid="stRadio"] > div { width: 100% !important; }
[data-testid="stSidebar"] [role="radiogroup"] {
  display: flex; flex-direction: column; gap: 2px; width: 100%;
}
[data-testid="stSidebar"] [data-testid="stRadioOption"] {
  display: flex; width: 100%; padding: 9px 12px; border-radius: 8px; margin: 0;
  transition: background-color .15s ease; cursor: pointer;
}
[data-testid="stSidebar"] [data-testid="stRadioOption"]:hover { background: rgba(255,255,255,.07); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:checked) {
  background: rgba(242,196,109,.16); box-shadow: inset 3px 0 0 var(--aura-gold);
}
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:checked) p { color: #FFFFFF; }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:focus-visible) {
  outline: 2px solid var(--aura-gold); outline-offset: 1px;
}
/* Hide the radio dot; selection is shown by the highlighted row. */
[data-testid="stSidebar"] [data-testid="stRadioOption"] > div > div > div:first-child:not([data-testid]) { display: none; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] p { font-size: .95rem; font-weight: 500; color: #D5DCEA; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] p span[role="img"] { margin-right: 4px; opacity: .9; }

/* Identity card */
.aura-id { display: flex; gap: 12px; align-items: center; padding: 14px; margin: 4px 0 14px;
  border-radius: 12px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); }
.aura-avatar { flex: 0 0 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  background: var(--aura-gold); color: var(--aura-navy); font-weight: 700; letter-spacing: .02em; }
.aura-id-name { font-weight: 600; color: #F4F6FA; line-height: 1.25; overflow-wrap: anywhere; }
.aura-id-meta { font-size: .78rem; color: #B8C2D6; overflow-wrap: anywhere; margin-top: 2px; }
.aura-role { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px;
  font-size: .72rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  background: rgba(242,196,109,.18); color: var(--aura-gold); }

/* Page header */
.aura-eyebrow { font-size: .74rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--aura-blue); margin: 0 0 -6px; }
.aura-subtitle { color: var(--aura-ink-soft); font-size: 1.02rem; max-width: 760px; margin: -6px 0 6px; }

/* Gate banner */
.aura-gate { display: flex; gap: 14px; align-items: flex-start; padding: 14px 18px; border-radius: 12px;
  background: var(--aura-amber-tint); border: 1px solid #EBD3A6; border-left: 5px solid var(--aura-amber); }
.aura-gate-icon { font-size: 1.4rem; line-height: 1; }
.aura-gate-title { font-weight: 700; color: var(--aura-amber-ink); letter-spacing: .02em; }
.aura-gate-text { color: #5C3D08; margin-top: 2px; }

/* Empty state */
.aura-empty { text-align: center; padding: 34px 18px; border: 1px dashed var(--aura-line);
  border-radius: 14px; background: rgba(255,255,255,.55); }
.aura-empty-icon { font-size: 1.8rem; }
.aura-empty-title { font-family: "Source Serif 4", Georgia, serif; font-size: 1.15rem; font-weight: 600;
  margin-top: 6px; color: var(--aura-ink); }
.aura-empty-hint { color: var(--aura-ink-soft); margin-top: 4px; }

/* Citation chips */
.aura-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.aura-claim { margin: 6px 0 2px; line-height: 1.45; color: var(--aura-ink); }
.aura-chip:focus { outline: 2px solid #1E5592; outline-offset: 2px; }
.aura-chip { display: inline-flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 10px;
  background: var(--aura-blue-tint); border: 1px solid #CFE0F2; max-width: 100%; }
.aura-chip-k { font-size: .72rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #1E5592; }
.aura-chip-v { color: var(--aura-ink); font-size: .92rem; overflow-wrap: anywhere; }

/* Signal chips (risk reasons) */
.aura-signals { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 4px; }
.aura-signal { display: inline-block; padding: 3px 10px; border-radius: 999px;
  background: #F1EEE7; border: 1px solid var(--aura-line); font-size: .82rem; color: var(--aura-ink); }

/* Agent pipeline stepper */
.aura-flow { display: flex; align-items: stretch; gap: 4px; margin: 8px 0 4px; overflow-x: auto; padding-bottom: 4px; }
.aura-arrow { align-self: center; color: #9AA3B2; font-size: 1.2rem; padding: 0 1px; flex: 0 0 auto; }
.aura-node { flex: 1 1 0; min-width: 92px; padding: 8px 9px; border-radius: 10px; background: var(--aura-surface);
  border: 1px solid var(--aura-line); border-top: 4px solid var(--aura-navy); box-shadow: var(--aura-shadow); }
.aura-node.agent { border-top-color: var(--aura-blue); }
.aura-node.gate { border-top-color: var(--aura-amber); background: #FFFBF3; }
.aura-node.publish { border-top-color: var(--aura-green); }
.aura-node-name { font-size: .78rem; font-weight: 600; color: var(--aura-ink); line-height: 1.2; }
.aura-node-state { font-size: .7rem; color: var(--aura-ink-soft); margin-top: 4px; display: flex; gap: 5px; align-items: center; }
.aura-node-note { font-size: .68rem; color: #6B7280; margin-top: 3px; }
.aura-subs { display: grid; gap: 2px; margin-top: 4px; }
.aura-sub { font-size: .7rem; color: var(--aura-ink-soft); display: flex; gap: 5px; align-items: center; }
.aura-dot { width: 8px; height: 8px; border-radius: 50%; background: #B8C0CC; display: inline-block; flex: 0 0 8px; }
.aura-dot.green { background: var(--aura-green); } .aura-dot.blue { background: var(--aura-blue); }
.aura-dot.orange { background: var(--aura-amber); } .aura-dot.red { background: var(--aura-red); }
.aura-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: .78rem; color: var(--aura-ink-soft); margin: 6px 0 2px; }
.aura-legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 3px;
  margin-right: 6px; vertical-align: -1px; background: var(--aura-navy); }
.aura-legend .agent::before { background: var(--aura-blue); }
.aura-legend .gate::before { background: var(--aura-amber); }
.aura-legend .publish::before { background: var(--aura-green); }

/* Login */
.aura-brand { border-radius: 20px; padding: 40px 36px; color: #E9EDF5; min-height: 560px;
  background: radial-gradient(120% 90% at 0% 0%, #2A3F6B 0%, #1B2A4A 55%, #142039 100%);
  box-shadow: 0 18px 50px rgba(20,33,61,.25); display: flex; flex-direction: column; gap: 22px; }
.aura-wordmark { font-family: "Source Serif 4", Georgia, serif; font-size: 2.6rem; font-weight: 700; letter-spacing: .06em; color: #fff; }
.aura-wordmark b { color: var(--aura-gold); }
.aura-promise { font-family: "Source Serif 4", Georgia, serif; font-size: 1.55rem; line-height: 1.3; color: #F4F6FA; max-width: 420px; }
.aura-brand p { color: #C5CEDF; line-height: 1.55; max-width: 440px; margin: 0; }
.aura-brand-flow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: auto; }
.aura-brand-flow .n { padding: 7px 11px; border-radius: 9px; font-size: .8rem; font-weight: 600;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); border-top: 3px solid #fff; }
.aura-brand-flow .n.coordinator { border-top-color: #9FB3D9; }
.aura-brand-flow .n.agent { border-top-color: #6FA4DD; }
.aura-brand-flow .n.gate { border-top-color: var(--aura-gold); }
.aura-brand-flow .n.publish { border-top-color: #5CC28E; }
.aura-brand-flow .a { color: #7F8DAA; }
.aura-fine { font-size: .78rem; color: #96A3BD; }

@media (max-width: 640px) {
  [data-testid="stMainBlockContainer"] { padding-top: 1.2rem; }
  .aura-brand { min-height: 0; padding: 26px 22px; }
  .aura-wordmark { font-size: 2rem; }
  .aura-promise { font-size: 1.25rem; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
</style>
"""


def esc(raw: Any) -> str:
    return html.escape("" if raw is None else str(raw), quote=True)


def _md_safe(text: Any) -> str:
    """Neutralise characters that would break Streamlit badge/markdown syntax."""
    return (
        str(text if text is not None else "")
        .replace("[", "(")
        .replace("]", ")")
        .replace("\n", " ")
    )


def inject_styles() -> None:
    st.html(CSS)


def brand() -> None:
    logo = ASSETS / "aura-logo.svg"
    mark = ASSETS / "aura-mark.svg"
    if logo.exists():
        st.logo(
            str(logo), size="large", icon_image=str(mark) if mark.exists() else None
        )


def hide_sidebar() -> None:
    st.html(
        "<style>[data-testid='stSidebar'],[data-testid='stSidebarCollapsedControl'],"
        "[data-testid='stExpandSidebarButton']{display:none!important}</style>"
    )


def initials(name: Any) -> str:
    parts = [p for p in str(name or "").replace(".", " ").split() if p[:1].isalpha()]
    if not parts:
        return "A"
    if parts[0].lower() in {"dr", "prof", "mr", "ms", "mrs"} and len(parts) > 1:
        parts = parts[1:]
    letters = parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")
    return letters.upper()


def identity_card(name: Any, role_label: str, detail: Any) -> None:
    st.sidebar.html(
        f"""<div class="aura-id"><div class="aura-avatar" aria-hidden="true">{esc(initials(name))}</div>
        <div><div class="aura-id-name">{esc(name)}</div><div class="aura-id-meta">{esc(detail)}</div>
        <span class="aura-role">{esc(role_label)}</span></div></div>"""
    )


def page_header(
    title: str, subtitle: str | None = None, eyebrow: str | None = None
) -> None:
    if eyebrow:
        st.html(f'<p class="aura-eyebrow">{esc(eyebrow)}</p>')
    st.title(title, anchor=False)
    if subtitle:
        st.html(f'<p class="aura-subtitle">{esc(subtitle)}</p>')


def section(title: str, caption: str | None = None, icon: str | None = None) -> None:
    st.subheader(f"{icon} {title}" if icon else title, anchor=False)
    if caption:
        st.caption(caption)


@contextmanager
def card(key: str, *, height: Any = "content"):
    with st.container(border=True, key=f"card_{key}", height=height):
        yield


def kpi_row(items: Sequence[dict[str, Any]]) -> None:
    """items: {label, value, icon?, help?, delta?, delta_color?, chart?}"""
    if not items:
        return
    cols = st.columns(len(items))
    for col, item in zip(cols, items):
        with col:
            st.metric(
                item["label"],
                item["value"],
                delta=item.get("delta"),
                delta_color=item.get("delta_color", "normal"),
                help=item.get("help"),
                icon=item.get("icon"),
                border=True,
                chart_data=item.get("chart"),
                chart_type=item.get("chart_type", "area"),
            )


def badge_md(label: Any, tone: str = "gray", icon: str = "") -> str:
    tone = tone if tone in TONES else "gray"
    text = _md_safe(label)
    return f":{tone}-badge[{icon + ' ' if icon else ''}{text}]"


def status_md(code: Any) -> str:
    return badge_md(
        labels.status_label(code), labels.status_tone(code), labels.status_icon(code)
    )


def risk_md(band: Any, score: Any = None) -> str:
    label, tone, icon = labels.RISK_BANDS.get(
        str(band or "not evaluated"), (labels.humanize(band), "gray", "")
    )
    suffix = f" · {score}" if score is not None else ""
    return badge_md(f"{label}{suffix}", tone, icon)


def status_badge(code: Any) -> None:
    st.markdown(status_md(code))


def gate_banner(text: str, title: str = "Human gate") -> None:
    st.html(
        f"""<div class="aura-gate" role="note"><div class="aura-gate-icon" aria-hidden="true">✋</div>
        <div><div class="aura-gate-title">{esc(title)}</div><div class="aura-gate-text">{esc(text)}</div></div></div>"""
    )


def empty_state(title: str, hint: str = "", icon: str = "🗂️") -> None:
    st.html(
        f"""<div class="aura-empty"><div class="aura-empty-icon" aria-hidden="true">{esc(icon)}</div>
        <div class="aura-empty-title">{esc(title)}</div>
        {f'<div class="aura-empty-hint">{esc(hint)}</div>' if hint else ""}</div>"""
    )


def citation_chips(citations: Iterable[dict[str, Any]]) -> None:
    chips = []
    for citation in citations:
        path = str(citation.get("evidencePath") or "")
        parts = path.split(".")
        source = labels.source_label(parts[1]) if len(parts) > 1 else "Evidence"
        chips.append(
            f'<div class="aura-chip" title="{esc(path)}"><span class="aura-chip-k">{esc(source)}</span>'
            f'<span class="aura-chip-v">{esc(labels.readable_claim(citation.get("statement")))}</span></div>'
        )
    if chips:
        st.html(f'<div class="aura-chips">{"".join(chips)}</div>')


def claim_chips(
    paths: Iterable[Any] | None,
    evidence_values: dict[str, Any] | None,
    signals: Iterable[dict[str, Any]] | None,
    policy: dict[str, Any] | None,
) -> str:
    """packet-v2 citation chips: metric (and course), cited value and threshold.
    Focusable, with the evidence path on hover. Every value is escaped."""
    chips = []
    signals = list(signals or [])
    for path in paths or []:
        parts = str(path).split(".")
        source = parts[1] if len(parts) > 1 else ""
        key = parts[3] if len(parts) > 3 else str(path)
        metric, _, course = key.partition("@")
        name = labels.EVIDENCE_FIELDS.get(metric, labels.humanize(metric))
        value = ((evidence_values or {}).get(source) or {}).get(key)
        threshold = labels.threshold_for(metric, signals, policy)
        text = labels.fmt_number(value) + (
            f" · threshold {labels.fmt_number(threshold)}"
            if threshold is not None
            else ""
        )
        heading = f"{name} · {course}" if course else name
        chips.append(
            f'<span class="aura-chip" tabindex="0" title="{esc(heading)}: {esc(text)} ({esc(path)})">'
            f'<span class="aura-chip-k">{esc(heading)}</span><span class="aura-chip-v">{esc(text)}</span></span>'
        )
    return f'<div class="aura-chips">{"".join(chips)}</div>' if chips else ""


def signal_chips(signals: Iterable[dict[str, Any]]) -> str:
    chips = "".join(
        f'<span class="aura-signal">{esc(labels.signal_label(s.get("code")))}</span>'
        for s in signals
    )
    return f'<div class="aura-signals">{chips}</div>' if chips else ""


def html_block(markup: str) -> None:
    """For markup assembled exclusively from esc()-escaped values."""
    st.html(markup)


def _state(state: dict[str, Any] | None) -> tuple[str, str, str]:
    if not state:
        return "Not reached", "gray", ""
    text, tone = labels.NODE_STATES.get(
        str(state.get("status")), (labels.humanize(state.get("status")), "gray")
    )
    visits = int(state.get("visits") or 0)
    tone = tone if tone in STATE_TONES else "gray"
    return text, tone, f" ×{visits}" if visits > 1 else ""


def _node(node_id: str, state: dict[str, Any] | None, *, note: str = "") -> str:
    name, role = labels.AGENT_NODES.get(node_id, (labels.humanize(node_id), "agent"))
    role = role if role in NODE_ROLES else "agent"
    text, tone, extra = _state(state)
    return (
        f'<div class="aura-node {role}" role="listitem"><div class="aura-node-name">{esc(name)}</div>'
        f'<div class="aura-node-state"><span class="aura-dot {tone}"></span>{esc(text)}{esc(extra)}</div>'
        f"{note}</div>"
    )


COLLECTORS = (
    "ContineoCollector",
    "LMSCollector",
    "InternshipCollector",
    "PlacementCollector",
)


SPECIALISTS = (
    "AcademicSpecialist",
    "AttendanceSpecialist",
    "WellbeingReferralSpecialist",
)


def _collectors(trace: dict[str, Any]) -> str:
    rows = []
    for node_id in COLLECTORS:
        text, tone, _ = _state(trace.get(node_id))
        short = labels.node_label(node_id).replace(" collector", "")
        rows.append(
            f'<div class="aura-sub"><span class="aura-dot {tone}" title="{esc(text)}"></span>{esc(short)}</div>'
        )
    return (
        '<div class="aura-node agent" role="listitem"><div class="aura-node-name">4 data agents</div>'
        f'<div class="aura-subs">{"".join(rows)}</div><div class="aura-node-note">in parallel</div></div>'
    )


def pipeline_stepper(trace: dict[str, Any] | None) -> None:
    trace = trace or {}
    repair = trace.get("Regenerator")
    repair_note = (
        f'<div class="aura-node-note">repairs ×{int(repair.get("visits") or 0)}</div>'
        if repair
        else '<div class="aura-node-note">≤2 repairs</div>'
    )
    parts = [
        _node("Coordinator", trace.get("Coordinator")),
        _collectors(trace),
        _node("EvidenceValidator", trace.get("EvidenceValidator")),
        _node("RiskAnalysisAgent", trace.get("RiskAnalysisAgent")),
        _node("HistoryRetriever", trace.get("HistoryRetriever")),
        _node(
            "RecommendationAgent",
            trace.get("RecommendationAgent"),
            note=next(
                (
                    f'<div class="aura-node-note">{esc(labels.node_label(n))}</div>'
                    for n in SPECIALISTS
                    if trace.get(n)
                ),
                "",
            ),
        ),
        _node("PacketValidator", trace.get("PacketValidator"), note=repair_note),
        _node("HumanGate", trace.get("HumanGate")),
        _node("DashboardPublisher", trace.get("DashboardPublisher")),
    ]
    arrow = '<div class="aura-arrow" aria-hidden="true">›</div>'
    legend = (
        '<div class="aura-legend"><span class="coordinator">Coordinator</span>'
        '<span class="agent">Specialist agent</span><span class="gate">Human gate</span>'
        '<span class="publish">Governed publish</span></div>'
    )
    st.html(
        f'<div class="aura-flow" role="list" aria-label="Agent pipeline">{arrow.join(parts)}</div>{legend}'
    )


def tech_details(
    pairs: Sequence[tuple[str, Any]], label: str = "Technical details"
) -> None:
    with st.expander(label, icon=":material/code:"):
        for key, raw in pairs:
            if raw is None or raw == "":
                continue
            st.markdown(f"**{_md_safe(key)}**")
            st.code(str(raw), language=None, wrap_lines=True)


def brand_panel() -> None:
    flow = [
        ("Coordinator", "coordinator"),
        ("4 data agents", "agent"),
        ("Risk & draft", "agent"),
        ("Mentor gate", "gate"),
        ("Publish", "publish"),
    ]
    steps = '<span class="a" aria-hidden="true">→</span>'.join(
        f'<span class="n {role}">{esc(name)}</span>' for name, role in flow
    )
    st.html(
        f"""<div class="aura-brand">
        <div class="aura-wordmark">AUR<b>A</b></div>
        <div class="aura-promise">Early support for every student. A mentor decides every step.</div>
        <p>Attendance, coursework, internship and placement signals come together in one evidence-backed view.
        AI agents draft and flag; nothing reaches a student or family until their mentor approves it.</p>
        <div class="aura-brand-flow" role="list" aria-label="How a review moves through AURA">{steps}</div>
        <div class="aura-fine">Student Success &amp; Early Warning System · Chapter 11 capstone</div>
        </div>"""
    )
