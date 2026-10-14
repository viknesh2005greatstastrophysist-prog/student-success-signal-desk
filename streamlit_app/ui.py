"""AURA visual components: the "Signal" design system (see docs/DESIGN_SYSTEM.md).

Presentation only. Every dynamic value that reaches custom HTML passes through
``esc``; tones, roles and icons come from fixed allowlists, never from records.
Native Streamlit elements are preferred wherever they can express the design.
"""

from __future__ import annotations

import base64
import html
import re
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

CSS = r"""
<style>
/* ==========================================================================
   AURA "Signal" design system. Quiet paper, ink and one signal colour.
   Tokens first, then base type, layout, navigation, components, motion.
   ========================================================================== */
:root {
  --paper: #F4F1EA; --surface: #FBFAF6; --ink: #0E1116; --ink-2: #3A3F47; --ink-3: #5B6068;
  --hairline: #E2DDD2; --hairline-2: #D3CDBF;
  --signal: #FF5A1F; --signal-ink: #B8360A; --signal-tint: #FFEDE4;
  --agent: #2B59FF; --agent-ink: #1F3FBF; --agent-tint: #E8EDFF; --agent-on-ink: #8BA3FF;
  --low: #2F9E6F; --medium: #E5A200; --high: #E5484D;
  --low-tint: #E2F3EA; --medium-tint: #FBF0CF; --high-tint: #FCE6E7;
  --font-display: "Instrument Serif", "Cormorant Garamond", Georgia, serif;
  --font-ui: "Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --ease: cubic-bezier(.22, .8, .2, 1);
  --s1: 8px; --s2: 16px; --s3: 24px; --s4: 32px; --s5: 40px; --s6: 48px; --s8: 64px; --s12: 96px;
  --radius: 16px;
  --lift: 0 14px 34px -14px rgba(14, 17, 22, .22), 0 2px 6px -2px rgba(14, 17, 22, .08);
}

/* ---- Base --------------------------------------------------------------- */
.stApp, [data-testid="stAppViewContainer"] { background: var(--paper); color: var(--ink); font-family: var(--font-ui); }
[data-testid="stHeader"] { background: transparent; height: 3rem; }
[data-testid="stMainBlockContainer"] { max-width: 1240px; padding: 56px 40px 96px; }
::selection { background: var(--ink); color: var(--paper); }
:focus-visible { outline: 2px solid var(--agent) !important; outline-offset: 2px; }
p, li, label, [data-testid="stMarkdownContainer"] { font-size: 15px; line-height: 1.55; }
a { text-underline-offset: 3px; }

h1, h2, h3 { font-family: var(--font-display) !important; font-weight: 400 !important; color: var(--ink); }
h1 { font-size: clamp(36px, 5.4vw, 60px) !important; line-height: 1.02 !important; letter-spacing: -.025em !important;
  padding: 0 !important; margin: 0 !important; overflow-wrap: anywhere; }
h1 em, h2 em, h3 em { font-style: italic; }
h2 { font-size: 36px !important; line-height: 1.08 !important; letter-spacing: -.02em !important; padding: 0 !important; }
h3 { font-size: 28px !important; line-height: 1.15 !important; letter-spacing: -.015em !important;
  padding: 0 !important; margin: var(--s5) 0 0 !important; }
h4 { font-family: var(--font-ui) !important; font-size: 16px !important; font-weight: 600 !important; letter-spacing: -.005em !important; padding: 0 !important; }
h5, h6 { font-family: var(--font-mono) !important; font-size: 11.5px !important; font-weight: 500 !important; letter-spacing: .1em !important;
  text-transform: uppercase; color: var(--ink-2); padding: 0 !important; margin: 0 !important; }
[data-testid="stCaptionContainer"], .stCaption, small { color: var(--ink-3); font-size: 13px; line-height: 1.5; }
code, kbd, pre, [data-testid="stCode"] { font-family: var(--font-mono) !important; font-size: .86em; }
code { background: #EFEBE1; border-radius: 6px; padding: .1em .4em; color: var(--ink); }
hr, [data-testid="stDivider"] hr { border: 0; border-top: 1px solid var(--hairline); margin: var(--s3) 0; }
.aura-num, [data-testid="stMetricValue"], [data-testid="stDataFrame"] { font-variant-numeric: tabular-nums; }

/* ---- Page header: eyebrow, serif title, one-line subtitle, hairline ------ */
.aura-eyebrow { display: flex; align-items: center; gap: 12px; margin: 0 0 var(--s2) !important; font-family: var(--font-mono);
  font-size: 11.5px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
.aura-eyebrow::before { content: ""; width: 24px; height: 1px; background: var(--ink); flex: 0 0 auto; }
.aura-eyebrow.plain::before { display: none; }
.aura-subtitle { color: var(--ink-2); font-size: 17px; line-height: 1.5; max-width: 62ch; margin: var(--s2) 0 0 !important; }
.aura-rule { border: 0; border-top: 1px solid var(--hairline); margin: var(--s4) 0 var(--s1); height: 0; }
.aura-plain { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 .5rem; }
.aura-plain-muted { color: var(--ink-3); font-size: 13px; }

/* ---- Sidebar: ink with paper text ---------------------------------------- */
[data-testid="stSidebar"] { background: var(--ink); border-right: 0; }
[data-testid="stSidebar"] [data-testid="stSidebarHeader"] { height: 0; min-height: 0; padding: 0; margin: 0; }
[data-testid="stSidebar"] [data-testid="stSidebarCollapseButton"] { position: absolute; top: 14px; right: 10px; z-index: 2; }
[data-testid="stSidebar"] [data-testid="stSidebarUserContent"] { padding: 28px 20px 24px; }
[data-testid="stSidebar"] [data-testid="stRadio"], [data-testid="stSidebar"] [data-testid="stRadio"] > div { width: 100% !important; }
[data-testid="stSidebar"] [role="radiogroup"] { display: flex; flex-direction: column; gap: 2px; width: 100%; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] { position: relative; display: flex; width: 100%; padding: 11px 14px 11px 16px;
  border-radius: 10px; margin: 0; overflow: hidden; cursor: pointer; transition: background-color .22s var(--ease); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
  border-radius: 0 3px 3px 0; background: var(--signal); transform: scaleY(0); transition: transform .28s var(--ease); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:hover { background: rgba(244, 241, 234, .06); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:checked) { background: var(--ink-2); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:checked)::before { transform: scaleY(1); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:checked) p { color: var(--paper); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:has(input:focus-visible) { outline: 2px solid var(--agent-on-ink); outline-offset: 1px; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] > div > div > div:first-child:not([data-testid]) { display: none; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] p { font-size: 15px; font-weight: 450; color: #C9CCD2; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] p span[role="img"] { margin-right: 6px; opacity: .85; }
[data-testid="stSidebar"] hr { border-top: 1px solid #2A2F37; margin: var(--s2) 0; }
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] { color: #8D929B; font-size: 12px; }
[data-testid="stSidebar"] .stButton button { background: transparent; color: var(--paper); border: 1px solid #3A3F47; }
[data-testid="stSidebar"] .stButton button:hover { background: var(--paper); color: var(--ink); border-color: var(--paper); }

.aura-brandbar { display: flex; align-items: center; gap: 12px; margin: 0 0 var(--s3); }
.aura-mark { width: 34px; height: 34px; flex: 0 0 34px; } .aura-mark-lg { width: 40px; height: 40px; flex-basis: 40px; }
.aura-brandword { font-family: var(--font-display); font-size: 30px; letter-spacing: .02em; color: var(--paper); line-height: 1; }
.aura-id { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 14px 4px 18px; margin: 0 0 var(--s2); border-bottom: 1px solid #2A2F37; }
.aura-avatar { flex: 0 0 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  background: var(--paper); color: var(--ink); font-family: var(--font-display); font-size: 19px; letter-spacing: .01em; }
.aura-id-name { font-weight: 550; color: var(--paper); line-height: 1.25; overflow-wrap: anywhere; font-size: 14.5px; }
.aura-id-meta { flex: 1 0 100%; font-family: var(--font-mono); font-size: 11px; color: #A8ADB6; overflow-wrap: anywhere; }
.aura-role { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid #4A505A;
  font-family: var(--font-mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--paper); }

/* ---- Cards: surface, hairline, 16px radius; soft lift on hover ----------- */
[class*="st-key-card_"] { background: var(--surface) !important; border: 1px solid var(--hairline) !important; border-radius: var(--radius) !important;
  box-shadow: none !important; padding: var(--s3) !important; transition: transform .28s var(--ease), box-shadow .28s var(--ease), border-color .28s var(--ease); }
[class*="st-key-card_"]:not(:has(form, [data-testid="stDataFrame"], [data-testid="stDataFrameResizable"], iframe, canvas)):hover {
  transform: translateY(-2px); box-shadow: var(--lift) !important; border-color: var(--hairline-2) !important; }
[class*="st-key-card_"] [data-testid="stForm"], [class*="st-key-gate_"] [data-testid="stForm"] { background: transparent; border: 0; padding: 0; box-shadow: none; }
/* Cards in a row share one height. */
[data-testid="stColumn"] > [data-testid="stVerticalBlock"]:has(> [data-testid="stLayoutWrapper"]:only-child) { height: 100%; }
[data-testid="stColumn"] > [data-testid="stVerticalBlock"] > [data-testid="stLayoutWrapper"]:only-child { flex: 1 1 auto; display: flex; flex-direction: column; }
[data-testid="stLayoutWrapper"]:only-child > [class*="st-key-"] { flex: 1 1 auto; }
[class*="st-key-kpin"] > [data-testid="stElementContainer"], [class*="st-key-kpisig_"] > [data-testid="stElementContainer"] { flex: 1 1 auto; }
[data-testid="stForm"] { border: 0 !important; padding: 0 !important; background: transparent; }
[data-testid="stMetric"] [data-testid="stMetric"] { border: 0; }

/* ---- KPI numerals: Geist, tabular, tight tracking, sized to fit ---------- */
[data-testid="stMetric"] { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: none;
  padding: var(--s3) !important; container-type: inline-size; height: 100%; min-height: 150px; position: relative;
  transition: transform .28s var(--ease), box-shadow .28s var(--ease), border-color .28s var(--ease); }
[data-testid="stMetric"]:hover { transform: translateY(-2px); box-shadow: var(--lift); border-color: var(--hairline-2); }
[data-testid="stMetric"] > div { gap: var(--s2); height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
[data-testid="stMetricLabel"] { color: var(--ink-2); }
[data-testid="stMetricLabel"] p, [data-testid="stMetricLabel"] { font-family: var(--font-ui); font-size: 11.5px !important; font-weight: 500 !important;
  letter-spacing: .08em; text-transform: uppercase; line-height: 1.35; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }
[data-testid="stMetricLabel"] > div { align-items: flex-start; gap: 8px; min-width: 0; }
[data-testid="stMetricLabel"], [data-testid="stMetricLabel"] * { overflow-wrap: normal !important; word-break: normal !important; hyphens: none; }
[data-testid="stMetricLabel"] [data-testid="stTooltipIcon"], [data-testid="stMetricLabel"] svg { flex: 0 0 auto; width: 15px; height: 15px; }
[class*="st-key-kpis_c5"] [data-testid="stMetric"], [class*="st-key-kpis_c6"] [data-testid="stMetric"] { padding: 18px 16px !important; min-height: 132px; }
[class*="st-key-kpis_c5"] [data-testid="stMetricLabel"] p, [class*="st-key-kpis_c6"] [data-testid="stMetricLabel"] p { font-size: 10.5px !important; letter-spacing: .05em; }
[data-testid="stMetricLabel"] [data-testid="stMetricIcon"], [data-testid="stMetricLabel"] > div > span:first-child { display: none; }
[data-testid="stMetricValue"], [data-testid="stMetricValue"] * { font-family: var(--font-ui) !important; font-weight: 500 !important; font-size: 48px; line-height: 1;
  letter-spacing: -.045em; color: var(--ink); font-variant-numeric: tabular-nums; white-space: normal !important; overflow: visible !important;
  text-overflow: clip !important; overflow-wrap: anywhere; }
[data-testid="stMetricDelta"] { font-family: var(--font-mono); font-size: 12px; }
/*KPI*/
[class*="st-key-kpisig_"] [data-testid="stMetric"] { border-color: #F3B9A0; background: linear-gradient(180deg, #FFF6F1 0%, var(--surface) 70%); }
[class*="st-key-kpisig_"] [data-testid="stMetricValue"] * { color: var(--signal-ink); }
[class*="st-key-kpisig_"] [data-testid="stMetric"]::before, [class*="st-key-kpisig_"] [data-testid="stMetric"]::after { content: ""; position: absolute; top: 18px; right: 18px; width: 9px; height: 9px;
  border-radius: 50%; background: var(--signal); }
[class*="st-key-kpisig_"] [data-testid="stMetric"]::before { animation: aura-ping 1.9s var(--ease) infinite; opacity: .5; }
[class*="st-key-kpis_"] [data-testid="stColumn"] > [data-testid="stVerticalBlock"],
[class*="st-key-kpin"], [class*="st-key-kpisig_"], [class*="st-key-kpin"] > [data-testid="stElementContainer"], [class*="st-key-kpisig_"] > [data-testid="stElementContainer"] { height: 100%; }

/* ---- Needs-you gate banner and the decision gate ------------------------- */
.aura-gate { display: flex; gap: 16px; align-items: flex-start; padding: var(--s3); border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--hairline); position: relative; }
.aura-gate::before, [class*="st-key-gate_"]::before { content: ""; position: absolute; left: -1px; top: 18px; bottom: 18px; width: 4px; border-radius: 0 4px 4px 0; background: var(--signal); }
.aura-gate-title { font-family: var(--font-display); font-size: 26px; line-height: 1.1; color: var(--ink); letter-spacing: -.01em; }
.aura-gate-text { color: var(--ink-2); margin-top: 6px; max-width: 70ch; }
.aura-pulse { position: relative; flex: 0 0 10px; width: 10px; height: 10px; margin-top: 9px; border-radius: 50%; background: var(--signal); display: inline-block; }
.aura-pulse::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--signal); animation: aura-ping 1.9s var(--ease) infinite; }

[class*="st-key-gate_"] { position: relative; background: var(--surface) !important; border: 1px solid var(--hairline) !important;
  border-radius: var(--radius) !important; box-shadow: 0 18px 40px -22px rgba(255, 90, 31, .45) !important; padding: var(--s4) !important; }
.aura-decision-head { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); align-items: flex-end; justify-content: space-between; margin-bottom: var(--s2); }
.aura-decision-title { font-family: var(--font-display); font-size: 40px; line-height: 1; letter-spacing: -.02em; color: var(--ink); margin: 0; }
.aura-decision-title em { color: var(--signal-ink); }
.aura-ref { font-family: var(--font-mono); font-size: 12px; color: var(--ink-2); line-height: 1.6; min-width: 0; max-width: 100%; }
.aura-ref b { font-weight: 500; color: var(--ink); letter-spacing: .08em; text-transform: uppercase; font-size: 11px; margin-right: 8px; }
.aura-ref .hash { display: block; overflow-wrap: anywhere; word-break: break-all; background: #EFEBE1; padding: 8px 10px; border-radius: 8px; margin-top: 4px; color: var(--ink); }

/* ---- Empty state --------------------------------------------------------- */
.aura-empty { padding: var(--s6) var(--s3); border: 1px dashed var(--hairline-2); border-radius: var(--radius); background: transparent; }
.aura-empty-kicker { font-family: var(--font-mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
.aura-empty-title { font-family: var(--font-display); font-size: 26px; line-height: 1.15; margin-top: 8px; color: var(--ink); }
.aura-empty-hint { color: var(--ink-2); margin-top: 6px; max-width: 60ch; }

/* ---- Chips: citations, signals, agent provenance -------------------------- */
.aura-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
.aura-claim { margin: 8px 0 2px; line-height: 1.5; color: var(--ink); }
.aura-chip { display: inline-flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 12px; background: var(--agent-tint);
  border: 1px solid #CBD6FF; max-width: 100%; }
.aura-chip-k { font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--agent-ink); }
.aura-chip-v { color: var(--ink); font-size: 14px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.aura-signals { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 4px; }
.aura-signal { display: inline-block; padding: 3px 10px; border-radius: 999px; background: transparent; border: 1px solid var(--hairline-2); font-size: 12.5px; color: var(--ink-2); }
.aura-agent { display: inline-flex; align-items: center; gap: 8px; padding: 3px 10px 3px 8px; border-radius: 999px; background: var(--agent-tint);
  border: 1px solid #CBD6FF; color: var(--agent-ink); font-family: var(--font-mono); font-size: 11px; line-height: 1.4; white-space: normal; }
.aura-agent::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--agent); flex: 0 0 6px; }
.aura-agent b { font-weight: 600; letter-spacing: .1em; text-transform: uppercase; font-size: 10px; }
.aura-agent span { color: var(--ink-2); overflow-wrap: anywhere; }
.aura-band { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.aura-band.low { background: var(--low); } .aura-band.medium { background: var(--medium); } .aura-band.high { background: var(--high); }
.aura-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); margin: 4px 0; }

/* ---- Agent pipeline stepper: a line that draws, nodes that light cobalt --- */
.aura-flow { --p: 0; position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; margin: var(--s3) 0 var(--s1); padding-top: 4px; }
.aura-flow::before, .aura-flow::after { content: ""; position: absolute; top: 15px; left: 5%; right: 5%; height: 2px; border-radius: 2px; }
.aura-flow::before { background: var(--hairline-2); }
.aura-flow::after { background: var(--agent); transform-origin: left center; transform: scaleX(var(--p)); right: 5%; width: 90%; left: 5%; animation: aura-draw .9s var(--ease) .15s backwards; }
.aura-node { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 0 2px; min-width: 0; }
.aura-pin { position: relative; width: 24px; height: 24px; border-radius: 50%; background: var(--paper); border: 2px solid var(--hairline-2); display: grid; place-items: center;
  transition: background-color .3s var(--ease), border-color .3s var(--ease); }
.aura-node.done .aura-pin { background: var(--agent); border-color: var(--agent); animation: aura-light .36s var(--ease) calc(.15s + var(--i, 0) * 70ms) backwards; }
.aura-node.done .aura-pin::after { content: ""; width: 5px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: translateY(-1px) rotate(45deg); }
.aura-node.running .aura-pin { border-color: var(--agent); }
.aura-node.running .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--agent); }
.aura-node.waiting .aura-pin { border-color: var(--signal); background: var(--signal-tint); }
.aura-node.waiting .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--signal); animation: aura-ping 1.9s var(--ease) infinite; }
.aura-node.failed .aura-pin { border-color: var(--high); background: var(--high-tint); }
.aura-node.failed .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--high); }
.aura-node.gate .aura-pin { border-radius: 7px; }
.aura-node-body { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.aura-node-name { font-size: 11.5px; font-weight: 550; color: var(--ink); line-height: 1.25; overflow-wrap: break-word; }
.aura-node-state:empty { display: none; }
.aura-node-state { font-family: var(--font-mono); font-size: 10px; color: var(--ink-3); letter-spacing: .04em; text-transform: uppercase; }
.aura-node.done .aura-node-state { color: var(--agent-ink); }
.aura-node.waiting .aura-node-state { color: var(--signal-ink); }
.aura-node.failed .aura-node-state { color: var(--high); }
.aura-node-note { font-size: 11px; color: var(--ink-3); line-height: 1.3; }
.aura-subs { display: grid; gap: 2px; }
.aura-sub { font-size: 11px; color: var(--ink-2); display: flex; gap: 5px; align-items: center; justify-content: center; }
.aura-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--hairline-2); display: inline-block; flex: 0 0 7px; }
.aura-dot.green { background: var(--low); } .aura-dot.blue { background: var(--agent); }
.aura-dot.orange { background: var(--signal); } .aura-dot.red { background: var(--high); }
.aura-legend { display: flex; flex-wrap: wrap; gap: 8px 20px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); margin: var(--s2) 0 0; letter-spacing: .04em; }
.aura-legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 0; background: var(--hairline-2); }
.aura-legend .done::before { background: var(--agent); } .aura-legend .waiting::before { background: var(--signal); }
.aura-legend .failed::before { background: var(--high); }

/* ---- Native widgets ------------------------------------------------------- */
.stButton button, .stDownloadButton button, [data-testid="stFormSubmitButton"] button, [data-testid^="stBaseButton"] {
  font-family: var(--font-ui); font-weight: 500; font-size: 14.5px; min-height: 44px; border-radius: 999px; padding: 0 22px;
  transition: transform .22s var(--ease), background-color .22s var(--ease), color .22s var(--ease), box-shadow .22s var(--ease), border-color .22s var(--ease); }
[data-testid="stBaseButton-secondary"], [data-testid="stBaseButton-secondaryFormSubmit"] { background: transparent; border: 1px solid var(--ink); color: var(--ink); }
[data-testid="stBaseButton-secondary"]:hover, [data-testid="stBaseButton-secondaryFormSubmit"]:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
[data-testid="stBaseButton-primary"], [data-testid="stBaseButton-primaryFormSubmit"] { background: var(--signal); color: var(--ink); border: 1px solid var(--signal); font-weight: 600; }
[data-testid="stBaseButton-primary"]:hover, [data-testid="stBaseButton-primaryFormSubmit"]:hover { background: #FF6D38; color: var(--ink); border-color: #FF6D38;
  transform: translateY(-1px); box-shadow: 0 12px 24px -10px rgba(255, 90, 31, .65); }
[data-testid^="stBaseButton"]:active { transform: scale(.98); }
[data-testid="stBaseButton-secondary"]:disabled, [data-testid="stBaseButton-primary"]:disabled { opacity: .45; }
[data-testid="stBaseButton-borderless"], [data-testid="stBaseButton-tertiary"] { background: transparent; border: 0; color: var(--ink-2); }

[data-baseweb="input"], [data-baseweb="base-input"], [data-baseweb="textarea"], [data-baseweb="select"] > div { background: var(--surface) !important; border-radius: 12px !important;
  border: 1px solid var(--hairline-2) !important; transition: border-color .2s var(--ease), box-shadow .2s var(--ease); }
[data-baseweb="input"]:focus-within, [data-baseweb="textarea"]:focus-within, [data-baseweb="select"] > div:focus-within { border-color: var(--ink) !important;
  box-shadow: 0 0 0 3px rgba(43, 89, 255, .16); }
[data-baseweb="input"] input, [data-baseweb="textarea"] textarea { font-family: var(--font-ui); font-size: 15px; }
[data-testid="stWidgetLabel"], [data-testid="stWidgetLabel"] p { font-size: 13px; font-weight: 500; color: var(--ink-2); }
[data-testid="stSelectbox"] [data-baseweb="select"] div[value], [data-testid="stSelectbox"] [data-baseweb="select"] span { white-space: normal; overflow-wrap: anywhere; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div { min-height: 44px; height: auto; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div > div:first-child { padding-top: 4px; padding-bottom: 4px; }

[data-testid="stSegmentedControl"] button, [data-testid="stButtonGroup"] button { border-radius: 999px !important; border: 1px solid var(--hairline-2) !important; background: transparent !important;
  color: var(--ink-2) !important; font-weight: 500; min-height: 40px; padding: 0 14px; transition: background-color .2s var(--ease), color .2s var(--ease), border-color .2s var(--ease); }
[data-testid="stSegmentedControl"] button:hover, [data-testid="stButtonGroup"] button:hover { border-color: var(--ink) !important; color: var(--ink) !important; }
[data-testid="stSegmentedControl"] button[aria-checked="true"], [data-testid="stSegmentedControl"] button[kind*="Active"], [data-testid="stButtonGroup"] button[aria-checked="true"],
[data-testid="stButtonGroup"] button[aria-pressed="true"], [data-testid="stButtonGroup"] button[data-testid*="Active"] { background: var(--ink) !important; color: var(--paper) !important; border-color: var(--ink) !important; }
[data-testid="stSegmentedControl"] [role="group"], [data-testid="stButtonGroup"] > div { flex-wrap: wrap; gap: 8px; }

[data-testid="stMain"] [data-testid="stRadio"] [role="radiogroup"] { gap: 8px 20px; }
[data-testid="stCheckbox"] label, [data-testid="stToggle"] label { font-size: 14.5px; }

[data-testid="stExpander"] details { background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px; overflow: hidden; }
[data-testid="stExpander"] details > summary { padding: 14px 18px; font-weight: 500; transition: background-color .2s var(--ease); }
[data-testid="stExpander"] details > summary:hover { background: #F6F3EC; }
[data-testid="stExpander"] details > summary p { overflow-wrap: anywhere; white-space: normal; }
[data-testid="stExpanderDetails"] { padding: 4px 18px 18px; }

[data-testid="stAlert"] { background: var(--surface) !important; border: 1px solid var(--hairline) !important; border-radius: 14px !important; color: var(--ink) !important; }
[data-testid="stAlert"] [data-testid="stAlertContainer"] { background: transparent; border-left: 3px solid var(--ink-2); border-radius: 0; padding: 14px 18px; }
[data-testid="stAlert"] p { color: var(--ink); }
[data-testid="stAlert"]:has([data-testid="stAlertContentInfo"]) [data-testid="stAlertContainer"] { border-left-color: var(--agent); }
[data-testid="stAlert"]:has([data-testid="stAlertContentSuccess"]) [data-testid="stAlertContainer"] { border-left-color: var(--low); }
[data-testid="stAlert"]:has([data-testid="stAlertContentWarning"]) [data-testid="stAlertContainer"] { border-left-color: var(--medium); }
[data-testid="stAlert"]:has([data-testid="stAlertContentError"]) [data-testid="stAlertContainer"] { border-left-color: var(--high); }

[data-testid="stProgress"] [role="progressbar"] { height: 6px; border-radius: 999px; background: var(--hairline); }
[data-testid="stProgress"] [role="progressbar"] > div { background: var(--ink); border-radius: 999px; }
[data-testid="stProgress"] p { font-family: var(--font-mono); font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }

[data-testid="stDataFrame"], [data-testid="stDataFrameResizable"] { border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; background: var(--surface); }
[data-testid="stArrowVegaLiteChart"], [data-testid="stVegaLiteChart"] { background: transparent; }
[data-testid="stElementToolbar"] { top: -4px; }
[data-testid="stCode"] pre, [data-testid="stCode"] { background: #EFEBE1 !important; border-radius: 10px; }
[data-testid="stToast"], [data-testid="stToastContainer"] [data-baseweb="toast"] { border-radius: 14px; border: 1px solid var(--hairline); }
[data-testid="stPopover"] button { border-radius: 999px; }
[data-testid="stSpinner"] { font-family: var(--font-mono); font-size: 13px; }

/* Forms keep a readable measure. */
[data-testid="stMain"] [data-testid="stForm"] { max-width: 860px; }
[data-testid="stMain"] [data-testid="stExpanderDetails"] [data-testid="stForm"] { max-width: none; }

/* ---- More native widgets ---------------------------------------------------- */
[data-baseweb="tag"] { background: #EFEBE1 !important; color: var(--ink) !important; border-radius: 999px !important; border: 1px solid var(--hairline-2); height: auto !important; padding: 2px 4px 2px 10px; }
[data-baseweb="tag"] span { color: var(--ink) !important; white-space: normal !important; max-width: none !important; font-size: 13px; }
[data-baseweb="tag"] svg { fill: var(--ink-2); }
.stButton button, .stDownloadButton button, [data-testid="stFormSubmitButton"] button { height: auto; padding-top: 10px; padding-bottom: 10px; }
.stButton button p, .stDownloadButton button p, [data-testid="stFormSubmitButton"] button p { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.3; }
[data-testid="stElementContainer"]:has([data-testid="stVegaLiteChart"]) [data-testid="stElementToolbar"],
[data-testid="stElementContainer"]:has([data-testid="stArrowVegaLiteChart"]) [data-testid="stElementToolbar"] { display: none; }
[data-testid="stVegaLiteChart"] canvas, [data-testid="stVegaLiteChart"] svg { max-width: 100%; }
.aura-insight { display: flex; gap: 16px; align-items: flex-start; padding: var(--s3); border: 1px dashed var(--hairline-2); border-radius: var(--radius); }
.aura-insight-title { font-family: var(--font-display); font-size: 24px; line-height: 1.15; color: var(--ink); }
.aura-insight-text { color: var(--ink-2); margin-top: 6px; max-width: 70ch; }
.aura-group { display: flex; align-items: baseline; gap: 12px; margin: var(--s3) 0 var(--s1); font-family: var(--font-mono); font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-2); }
.aura-group b { font-family: var(--font-display); font-size: 28px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--ink); }

/* ---- Tabs: underline that draws in ---------------------------------------- */
[data-baseweb="tab-list"] { gap: 28px; border-bottom: 1px solid var(--hairline); background: transparent; flex-wrap: wrap; row-gap: 0; }
[data-baseweb="tab-border"], [data-baseweb="tab-highlight"] { display: none; }
[data-baseweb="tab"] { position: relative; background: transparent !important; padding: 12px 0 !important; margin: 0; height: auto; }
[data-baseweb="tab"] p, [data-baseweb="tab"] { font-family: var(--font-ui); font-size: 14.5px; font-weight: 500; color: var(--ink-3); transition: color .2s var(--ease); }
[data-baseweb="tab"]::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--ink); transform: scaleX(0);
  transform-origin: left center; transition: transform .32s var(--ease), opacity .32s var(--ease); }
[data-baseweb="tab"]:hover { color: var(--ink); }
[data-baseweb="tab"]:hover::after { transform: scaleX(1); opacity: .28; }
[data-baseweb="tab"][aria-selected="true"], [data-baseweb="tab"][aria-selected="true"] p { color: var(--ink); }
[data-baseweb="tab"][aria-selected="true"]::after { transform: scaleX(1); opacity: 1; }
[data-baseweb="tab-panel"] { padding-top: var(--s3); }

/* ---- Streamlit badges (status, risk) ---------------------------------------- */
[data-testid="stMarkdownContainer"] span[class*="Badge"], .stMarkdownBadge { border-radius: 999px; font-family: var(--font-ui); font-size: 12.5px; font-weight: 500; letter-spacing: .01em; }

/* ---- Sign-in: split screen ---------------------------------------------------- */
.st-key-login_shell { display: grid !important; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); gap: 0 !important; min-height: 100dvh; align-items: stretch; }
.st-key-login_shell > [data-testid="stElementContainer"], .st-key-login_shell > [data-testid="stLayoutWrapper"] { min-width: 0; }
.st-key-login_shell > [data-testid="stElementContainer"]:first-child { height: 100%; }
.st-key-login_panel { max-width: 480px; width: 100%; margin: 0 auto; padding: var(--s12) var(--s4) var(--s8); justify-content: center; min-height: 100dvh; gap: var(--s2) !important; }
.st-key-login_panel [data-testid="stCaptionContainer"] { color: var(--ink-3); }
.st-key-login_panel h2 { margin-bottom: 4px !important; }
.st-key-login_panel [data-testid="stBaseButton-primaryFormSubmit"] { min-height: 52px; font-size: 15.5px; justify-content: center; }
.st-key-login_panel [data-testid="stBaseButton-primaryFormSubmit"] p::after { content: ""; display: inline-block; width: 28px; height: 28px; margin-left: 12px; border-radius: 50%;
  background: var(--ink) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8h10M9 4l4 4-4 4' fill='none' stroke='%23F4F1EA' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 16px no-repeat;
  transition: transform .25s var(--ease); vertical-align: middle; }
.st-key-login_panel [data-testid="stBaseButton-primaryFormSubmit"]:hover p::after { transform: translateX(3px); }
.st-key-login_panel .aura-eyebrow { margin-bottom: 20px !important; }
.aura-hero { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: var(--s6); min-height: 100dvh; height: 100%;
  padding: var(--s8) clamp(32px, 5vw, 72px) var(--s5); color: var(--paper); background: var(--ink); box-sizing: border-box; }
.aura-hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .05;
  background: repeating-linear-gradient(0deg, var(--paper) 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, var(--paper) 0 1px, transparent 1px 64px); }
.aura-hero::after { content: ""; position: absolute; width: 560px; height: 560px; right: -200px; top: -220px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(43, 89, 255, .28), transparent); }
.aura-hero > * { position: relative; z-index: 1; }
.aura-hero-top { display: flex; align-items: center; gap: 14px; }
.aura-hero-word { font-family: var(--font-display); font-size: 34px; letter-spacing: .04em; line-height: 1; }
.aura-hero-eyebrow { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; color: #A8ADB6; margin: 0 0 var(--s3); }
.aura-hero-title { font-family: var(--font-display); font-size: clamp(44px, 6.2vw, 92px); line-height: .96; letter-spacing: -.03em; margin: 0; color: var(--paper); }
.aura-hero-title em { font-style: italic; }
.aura-hero-sub { color: #B9BDC5; font-size: 16.5px; line-height: 1.55; max-width: 46ch; margin: var(--s3) 0 0; }
.aura-signal-line.still { display: none; }
@media (prefers-reduced-motion: reduce) { .aura-signal-line.anim { display: none; } .aura-signal-line.still { display: block; } }
.aura-signal-line { display: block; width: 100%; max-width: 620px; height: auto; margin-top: var(--s5); overflow: visible; }
.aura-hero-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: var(--s5); font-family: var(--font-mono); font-size: 12px; color: #C9CCD2; }
.aura-hero-flow .n { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid #3A3F47; white-space: nowrap; }
.aura-hero-flow .n.agent i { color: var(--agent-on-ink); }
.aura-hero-flow .n.gate { border-color: rgba(255, 90, 31, .55); color: var(--paper); }
.aura-hero-flow .n.gate i { color: var(--signal); }
.aura-hero-flow .n.publish i { color: #5CC28E; }
.aura-hero-flow .n i { font-style: normal; color: #6C717A; letter-spacing: .06em; }
.aura-hero-foot { font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; color: #8D929B; }

/* ---- Motion ----------------------------------------------------------------------- */
@keyframes aura-rise { from { opacity: 0; transform: translateY(12px); } }
@keyframes aura-fade { from { opacity: 0; } }
@keyframes aura-ping { 0% { transform: scale(1); opacity: .55; } 80%, 100% { transform: scale(3); opacity: 0; } }
@keyframes aura-ring { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(3.4); opacity: 0; } }
@keyframes aura-trace { from { stroke-dashoffset: 1; } }
@keyframes aura-draw { from { transform: scaleX(0); } }
@keyframes aura-light { from { transform: scale(.6); background: var(--paper); } }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > * { animation: aura-rise .38s var(--ease) backwards; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(2) { animation-delay: .04s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(3) { animation-delay: .08s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(4) { animation-delay: .12s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(5) { animation-delay: .16s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(6) { animation-delay: .2s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(7) { animation-delay: .24s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(8) { animation-delay: .28s; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:nth-child(n+9) { animation-delay: .32s; }
[data-testid="stColumn"] > [data-testid="stVerticalBlock"] > * { animation: aura-rise .38s var(--ease) backwards; }
[data-testid="stColumn"]:nth-child(2) > [data-testid="stVerticalBlock"] > * { animation-delay: .06s; }
[data-testid="stColumn"]:nth-child(3) > [data-testid="stVerticalBlock"] > * { animation-delay: .12s; }
[data-testid="stColumn"]:nth-child(4) > [data-testid="stVerticalBlock"] > * { animation-delay: .18s; }
[data-testid="stColumn"]:nth-child(5) > [data-testid="stVerticalBlock"] > * { animation-delay: .24s; }
[data-testid="stColumn"]:nth-child(n+6) > [data-testid="stVerticalBlock"] > * { animation-delay: .3s; }

/* ---- Small screens: content first, tidy stacking ------------------------------------- */
@media (max-width: 880px) {
  .st-key-login_shell { grid-template-columns: 1fr; min-height: 0; }
  .st-key-login_panel { min-height: 0; padding: var(--s4) var(--s3) var(--s6); justify-content: flex-start; }
  .aura-hero { min-height: 0; height: auto; gap: 0; padding: 20px 24px 22px; }
  .aura-hero-eyebrow, .aura-hero-sub, .aura-hero-flow, .aura-hero-foot { display: none; }
  .aura-hero .aura-signal-line { display: none !important; }
  .aura-hero::after { display: none; }
  .aura-hero-word { font-size: 26px; }
  .aura-hero-top { margin-bottom: 14px; }
  .aura-hero-title { font-size: 30px; line-height: 1; }
}
@media (max-width: 640px) {
  [data-testid="stMainBlockContainer"] { padding: 56px 20px 64px; }
  h3 { font-size: 24px !important; margin-top: var(--s4) !important; }
  .aura-subtitle { font-size: 15.5px; }
  .aura-rule { margin: var(--s3) 0 var(--s1); }
  [class*="st-key-kpis_"] [data-testid="stHorizontalBlock"] { flex-direction: row !important; flex-wrap: wrap !important; gap: 12px !important; }
  [class*="st-key-kpis_"] [data-testid="stColumn"] { flex: 1 1 calc(50% - 6px) !important; min-width: calc(50% - 6px) !important; width: calc(50% - 6px) !important; }
  [data-testid="stMetric"] { padding: 16px !important; }
  [class*="st-key-card_"] { padding: var(--s2) !important; }
  [class*="st-key-gate_"] { padding: var(--s3) var(--s2) !important; }
  .aura-decision-title { font-size: 32px; }
  .aura-gate { padding: var(--s2); }
  /* The pipeline reads top to bottom on a phone: vertical line, nodes as rows. */
  .aura-flow { grid-auto-flow: row; grid-auto-columns: 1fr; gap: 14px; padding-left: 2px; }
  .aura-flow::before, .aura-flow::after { top: 12px; bottom: 12px; left: 13px; right: auto; width: 2px; height: auto; }
  .aura-flow::after { transform: scaleY(var(--p)); transform-origin: top center; width: 2px; animation-name: aura-draw-y; }
  .aura-node { flex-direction: row; align-items: flex-start; text-align: left; gap: 12px; }
  .aura-node > .aura-pin { flex: 0 0 24px; margin-top: 0; }
  .aura-node-body { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
  .aura-sub { justify-content: flex-start; }
}
@keyframes aura-draw-y { from { transform: scaleY(0); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
</style>
"""


def _kpi_rules() -> str:
    """Numerals shrink with the length of the value so a figure never clips (#17)."""
    rules = []
    for chars in range(1, 17):
        size = round(135 / chars, 1)
        rules.append(
            f'[class*="st-key-kpin{chars}_"] [data-testid="stMetricValue"], '
            f'[class*="st-key-kpin{chars}_"] [data-testid="stMetricValue"] *, '
            f'[class*="st-key-kpisig_n{chars}_"] [data-testid="stMetricValue"], '
            f'[class*="st-key-kpisig_n{chars}_"] [data-testid="stMetricValue"] * '
            f"{{ font-size: clamp(15px, {size}cqi, 52px); }}"
        )
    return "\n".join(rules)


STYLES = CSS.replace("/*KPI*/", _kpi_rules())
_KPI_SEQ = {"n": 0}


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


def _md_escape(text: Any) -> str:
    """Escape Markdown punctuation so a title renders literally."""
    return re.sub(r"([\\`*_{}\[\]()#+!|<>~$])", r"\\\1", str(text if text is not None else ""))


def code_span(text: Any) -> str:
    """Wrap text in a Markdown code span so underscores and brackets (file names) show literally."""
    flat = " ".join(str(text if text is not None else "").split())
    return f"`{flat.replace('`', chr(39))}`"


def plain_text(text: Any, *, muted: bool = False) -> None:
    """Show author-written text literally: no Markdown, links, badges or shortcodes."""
    tone = " aura-plain-muted" if muted else ""
    st.html(f'<p class="aura-plain{tone}">{esc(text)}</p>')


def inject_styles() -> None:
    _KPI_SEQ["n"] = 0
    st.html(STYLES)


def _svg_img(svg: str, *, css: str, alt: str = "") -> str:
    """Inline SVG is sanitised away by st.html, so graphics travel as data-URI images.
    Animation lives inside the SVG's own stylesheet, which runs in an image context."""
    data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f'<img class="{css}" alt="{esc(alt)}" src="data:image/svg+xml;base64,{data}" />'


MARK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<path d="M9 52 L32 14 L55 52" fill="none" stroke="#F4F1EA" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    '<circle cx="32" cy="14" r="6.5" fill="#FF5A1F"/></svg>'
)


def brand() -> None:
    st.sidebar.html(
        f'<div class="aura-brandbar">{_svg_img(MARK_SVG, css="aura-mark")}<span class="aura-brandword">Aura</span></div>'
    )


def hide_sidebar() -> None:
    """Sign-in is full bleed: no sidebar, no page padding, no app header."""
    st.html(
        "<style>[data-testid='stSidebar'],[data-testid='stSidebarCollapsedControl'],"
        "[data-testid='stExpandSidebarButton'],[data-testid='stHeader']{display:none!important}"
        "[data-testid='stMainBlockContainer']{max-width:none!important;padding:0!important}"
        "[data-testid='stMainBlockContainer']>[data-testid='stVerticalBlock']{gap:0!important}"
        "[data-testid='stMainBlockContainer']>[data-testid='stVerticalBlock']>*,"
        ".st-key-login_shell>*{animation:none!important}</style>"
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
        <div><div class="aura-id-name">{esc(name)}</div><span class="aura-role">{esc(role_label)}</span></div>
        <div class="aura-id-meta">{esc(detail)}</div></div>"""
    )


def _title_markdown(title: str, em: str | None) -> str:
    """Escaped title with one italic word (the last one unless named)."""
    text = str(title or "")
    word = (em or "").strip()
    if not word:
        tokens = text.split()
        word = tokens[-1] if tokens and len(tokens) > 1 else ""
    core = word.strip(".,;:!?()\"'")
    index = text.rfind(core) if core else -1
    if index < 0:
        return _md_escape(text)
    return (
        _md_escape(text[:index])
        + f"*{_md_escape(core)}*"
        + _md_escape(text[index + len(core) :])
    )


def page_header(
    title: str,
    subtitle: str | None = None,
    eyebrow: str | None = None,
    em: str | None = None,
) -> None:
    """Role eyebrow (mono), serif title with one italic word, one-line subtitle, hairline."""
    if eyebrow:
        st.html(f'<p class="aura-eyebrow">{esc(eyebrow)}</p>')
    st.title(_title_markdown(title, em), anchor=False)
    if subtitle:
        st.html(f'<p class="aura-subtitle">{esc(subtitle)}</p>')
    st.html('<hr class="aura-rule" />')


def section(title: str, caption: str | None = None, icon: str | None = None) -> None:
    st.subheader(title, anchor=False)
    if caption:
        st.caption(caption)


@contextmanager
def card(key: str, *, height: Any = "content"):
    with st.container(border=True, key=f"card_{key}", height=height):
        yield


def kpi_row(items: Sequence[dict[str, Any]]) -> None:
    """items: {label, value, icon?, help?, delta?, delta_color?, chart?, signal?}

    ``signal`` marks a KPI that is waiting on a human: vermilion numeral and a pulsing dot
    while its value is above zero."""
    if not items:
        return
    _KPI_SEQ["n"] += 1
    # Numerals in one row share one size, set by the longest figure; words size themselves.
    figure = re.compile(r"^[\d\s.,%₹/—-]+(of[\d\s.,%₹/—-]+)?$")
    figure_len = max(
        (len(str(i["value"])) for i in items if figure.match(str(i["value"]))), default=1
    )
    with st.container(key=f"kpis_c{len(items)}_{_KPI_SEQ['n']}"):
        cols = st.columns(len(items))
        for col, item in zip(cols, items):
            with col:
                _KPI_SEQ["n"] += 1
                text = str(item["value"])
                chars = max(1, min(16, figure_len if figure.match(text) else len(text)))
                waiting = bool(item.get("signal")) and text not in {"0", "", "None"}
                prefix = "kpisig_n" if waiting else "kpin"
                with st.container(key=f"{prefix}{chars}_{_KPI_SEQ['n']}"):
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


def agent_chip(model: Any = None, label: str = "agent") -> str:
    """Cobalt provenance chip for anything an AI produced. Returns escaped markup."""
    full = str(model or "").strip()
    name = full.split(";")[0].strip()
    inner = f"<b>{esc(label)}</b>" + (f"<span>{esc(name)}</span>" if name else "")
    return f'<span class="aura-agent" title="{esc(full) or "Produced by an AI model"}">{inner}</span>'


def agent_chip_block(model: Any = None, label: str = "agent", note: str = "") -> None:
    extra = f'<span class="aura-plain-muted">{esc(note)}</span>' if note else ""
    st.html(f'<div class="aura-meta">{agent_chip(model, label)}{extra}</div>')


def gate_banner(text: str, title: str = "Human gate") -> None:
    st.html(
        f"""<div class="aura-gate" role="note"><span class="aura-pulse" aria-hidden="true"></span>
        <div><div class="aura-gate-title">{esc(title)}</div><div class="aura-gate-text">{esc(text)}</div></div></div>"""
    )


def decision_head(version: Any, content_hash: Any) -> None:
    """Head of the mentor decision gate: serif title, exact version and hash in mono."""
    st.html(
        f"""<div class="aura-decision-head"><div>
        <p class="aura-eyebrow plain"><span class="aura-pulse" style="margin:0 10px 0 0" aria-hidden="true"></span>Awaiting your decision</p>
        <p class="aura-decision-title">Your <em>decision</em></p></div>
        <div class="aura-ref"><b>Version</b>{esc(version)}<span class="hash"><b>Hash</b>{esc(content_hash)}</span></div></div>"""
    )


def empty_state(title: str, hint: str = "", icon: str = "") -> None:
    """Quiet empty state. ``icon`` is accepted for compatibility and ignored: no emoji."""
    st.html(
        f"""<div class="aura-empty"><div class="aura-empty-kicker">Nothing here yet</div>
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


_STATE_DEFAULT = {"text": "Not reached"}


def _state(state: dict[str, Any] | None) -> tuple[str, str, str]:
    if not state:
        return _STATE_DEFAULT["text"], "gray", ""
    text, tone = labels.NODE_STATES.get(
        str(state.get("status")), (labels.humanize(state.get("status")), "gray")
    )
    visits = int(state.get("visits") or 0)
    tone = tone if tone in STATE_TONES else "gray"
    return text, tone, f" ×{visits}" if visits > 1 else ""


# node state -> stepper class. "done" lights the node cobalt.
_STEP_CLASS = {
    "green": "done",
    "blue": "running",
    "orange": "waiting",
    "red": "failed",
    "gray": "idle",
}


def _node(
    node_id: str, state: dict[str, Any] | None, *, note: str = "", index: int = 0
) -> str:
    name, role = labels.AGENT_NODES.get(node_id, (labels.humanize(node_id), "agent"))
    role = role if role in NODE_ROLES else "agent"
    text, tone, extra = _state(state)
    step = _STEP_CLASS.get(tone, "idle")
    return (
        f'<div class="aura-node {role} {step}" role="listitem" style="--i:{index}"><span class="aura-pin" aria-hidden="true"></span>'
        f'<div class="aura-node-body"><div class="aura-node-name">{esc(name)}</div>'
        f'<div class="aura-node-state">{esc(text)}{esc(extra)}</div>{note}</div></div>'
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


def _collectors(trace: dict[str, Any], index: int) -> str:
    rows = []
    states = []
    for node_id in COLLECTORS:
        text, tone, _ = _state(trace.get(node_id))
        states.append(tone)
        short = labels.node_label(node_id).replace(" collector", "")
        rows.append(
            f'<div class="aura-sub"><span class="aura-dot {tone}" title="{esc(text)}"></span>{esc(short)}</div>'
        )
    if states and all(tone == "green" for tone in states):
        step, text = "done", "Done"
    elif "red" in states:
        step, text = "failed", "Failed"
    elif "blue" in states or "orange" in states:
        step, text = "running", "Running"
    else:
        step, text = "idle", _STATE_DEFAULT["text"]
    return (
        f'<div class="aura-node agent {step}" role="listitem" style="--i:{index}"><span class="aura-pin" aria-hidden="true"></span>'
        f'<div class="aura-node-body"><div class="aura-node-name">4 data agents</div>'
        f'<div class="aura-node-state">{text}</div>'
        f'<div class="aura-subs">{"".join(rows)}</div></div></div>'
    )


def pipeline_stepper(
    trace: dict[str, Any] | None, *, empty_text: str = "Not reached"
) -> None:
    trace = trace or {}
    _STATE_DEFAULT["text"] = empty_text if not trace else "Not reached"
    repair = trace.get("Regenerator")
    repair_note = (
        f'<div class="aura-node-note">repairs ×{int(repair.get("visits") or 0)}</div>'
        if repair
        else '<div class="aura-node-note">up to 2 repairs</div>'
    )
    specs: list[tuple[str, Any]] = [
        ("Coordinator", ""),
        ("__collectors__", ""),
        ("EvidenceValidator", ""),
        ("RiskAnalysisAgent", ""),
        ("HistoryRetriever", ""),
    ]
    if trace.get("InvestigatorAgent"):
        specs.append(("InvestigatorAgent", ""))
    specs.append(
        (
            "RecommendationAgent",
            next(
                (
                    f'<div class="aura-node-note">{esc(labels.node_label(n))}</div>'
                    for n in SPECIALISTS
                    if trace.get(n)
                ),
                "",
            ),
        )
    )
    specs += [("PacketValidator", repair_note), ("HumanGate", ""), ("DashboardPublisher", "")]
    parts: list[str] = []
    done = 0
    for index, (node_id, note) in enumerate(specs):
        if node_id == "__collectors__":
            parts.append(_collectors(trace, index))
            done += int(
                all(
                    labels.NODE_STATES.get(str((trace.get(c) or {}).get("status")), ("", ""))[1]
                    == "green"
                    for c in COLLECTORS
                )
            )
        else:
            parts.append(_node(node_id, trace.get(node_id), note=note, index=index))
            done += int(
                labels.NODE_STATES.get(str((trace.get(node_id) or {}).get("status")), ("", ""))[1]
                == "green"
            )
    progress = round(done / max(1, len(specs) - 1), 3)
    legend = (
        '<div class="aura-legend"><span class="done">Done</span><span class="waiting">Waiting on a person</span>'
        '<span class="failed">Needs attention</span><span>Not reached</span></div>'
    )
    st.html(
        f'<div class="aura-flow" role="list" aria-label="Agent pipeline" style="--p:{min(1.0, progress)}">{"".join(parts)}</div>{legend}'
    )


def insight(title: str, text: str) -> None:
    """A quiet note that says why something is not shown (instead of an empty chart)."""
    st.html(
        f"""<div class="aura-insight"><span class="aura-pulse" style="background:var(--ink-3)" aria-hidden="true"></span>
        <div><div class="aura-insight-title">{esc(title)}</div><div class="aura-insight-text">{esc(text)}</div></div></div>"""
    )


def group_heading(initial: str, count: int) -> None:
    st.html(f'<div class="aura-group"><b>{esc(initial)}</b><span>{esc(count)} students</span></div>')


def tech_details(
    pairs: Sequence[tuple[str, Any]], label: str = "Technical details"
) -> None:
    with st.expander(label, icon=":material/code:"):
        for key, raw in pairs:
            if raw is None or raw == "":
                continue
            st.markdown(f"**{_md_safe(key)}**")
            st.code(str(raw), language=None, wrap_lines=True)


# ---------------------------------------------------------------------------
# Sign-in: a split screen. Ink hero on the left, the form on the right.
# ---------------------------------------------------------------------------
_SIGNAL_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 150">
<style>
.grid{stroke:#F4F1EA;stroke-opacity:.18;stroke-width:1;stroke-dasharray:2 5}
.lab{fill:#8D929B;font:10px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
.trace{fill:none;stroke:#F4F1EA;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0;animation:t 2.4s cubic-bezier(.65,0,.35,1) .5s backwards}
.dot{fill:#FF5A1F;animation:f .4s ease-out 2.7s backwards}
.ring{fill:none;stroke:#FF5A1F;stroke-width:1.5;transform-box:fill-box;transform-origin:center;animation:r 2.2s ease-out 2.9s infinite}
@keyframes t{from{stroke-dashoffset:1}}
@keyframes f{from{opacity:0}}
@keyframes r{0%{transform:scale(1);opacity:.8}100%{transform:scale(3.4);opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<line class="grid" x1="0" y1="96" x2="600" y2="96"/>
<text class="lab" x="0" y="86">threshold</text>
<path class="trace" pathLength="1" d="M0 58 C34 52 58 70 96 62 S150 46 190 56 S244 74 286 70 S340 62 372 82 S430 112 478 120 S548 128 580 132"/>
<circle class="ring" cx="580" cy="132" r="8"/>
<circle class="dot" cx="580" cy="132" r="6"/>
</svg>"""


_SIGNAL_STILL = (
    _SIGNAL_SVG.split("<style>")[0]
    + "<style>.grid{stroke:#F4F1EA;stroke-opacity:.18;stroke-width:1;stroke-dasharray:2 5}"
    ".lab{fill:#8D929B;font:10px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}"
    ".trace{fill:none;stroke:#F4F1EA;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}"
    ".dot{fill:#FF5A1F}.ring{fill:none;stroke:#FF5A1F;stroke-width:1.5;opacity:.5}</style>"
    + _SIGNAL_SVG.split("</style>")[1]
)


def brand_panel() -> None:
    flow = [
        ("Coordinator", ""),
        ("4 data agents", "agent"),
        ("Risk + draft", "agent"),
        ("Mentor gate", "gate"),
        ("Publish", "publish"),
    ]
    steps = "".join(
        f'<span class="n {role}"><i>{index:02d}</i>{esc(name)}</span>'
        for index, (name, role) in enumerate(flow, start=1)
    )
    st.html(
        f"""<section class="aura-hero">
        <div class="aura-hero-top">{_svg_img(MARK_SVG, css="aura-mark aura-mark-lg")}<span class="aura-hero-word">Aura</span></div>
        <div>
          <p class="aura-hero-eyebrow">Student success and early warning</p>
          <p class="aura-hero-title" role="heading" aria-level="2">Every student, <em>seen early.</em></p>
          <p class="aura-hero-sub">Attendance, coursework, internship and placement signals in one evidence-backed view.
          Agents draft and flag; nothing reaches a student or family until their mentor approves it.</p>
          {_svg_img(_SIGNAL_SVG, css="aura-signal-line anim", alt="A line charting a student's attendance drifting below a threshold, with the moment a mentor is asked highlighted")}
          {_svg_img(_SIGNAL_STILL, css="aura-signal-line still", alt="")}
          <div class="aura-hero-flow" role="list" aria-label="How a review moves through AURA">{steps}</div>
        </div>
        <div class="aura-hero-foot">Chapter 11 capstone / governed agentic runtime</div>
        </section>"""
    )


# ---------------------------------------------------------------------------
# Charts (Altair): paper, hairline gridlines, ink axes, risk-band colours.
# ---------------------------------------------------------------------------
RISK_DOMAIN = ["low", "medium", "high"]
RISK_RANGE = ["#2F9E6F", "#E5A200", "#E5484D"]
SERIES_RANGE = ["#2B59FF", "#2F9E6F", "#E5A200", "#E5484D", "#0E1116", "#8A8F98"]


def style_chart(chart: Any, *, height: int | None = None) -> Any:
    """Apply the Signal chart look to an Altair chart (presentation only)."""
    chart = chart.configure(background="#FBFAF6", padding={"left": 8, "right": 12, "top": 8, "bottom": 4})
    chart = chart.configure_view(stroke=None)
    chart = chart.configure_axis(
        gridColor="#E2DDD2",
        gridWidth=1,
        domainColor="#0E1116",
        tickColor="#0E1116",
        labelColor="#3A3F47",
        titleColor="#3A3F47",
        labelFont="Geist Mono, ui-monospace, monospace",
        titleFont="Geist, system-ui, sans-serif",
        labelFontSize=11,
        titleFontSize=11,
        titleFontWeight=500,
        labelPadding=6,
    )
    chart = chart.configure_legend(
        labelColor="#3A3F47",
        titleColor="#3A3F47",
        labelFont="Geist, system-ui, sans-serif",
        titleFont="Geist, system-ui, sans-serif",
        labelFontSize=12,
        titleFontSize=11,
        orient="bottom",
        symbolType="circle",
        columns=0,
    )
    chart = chart.configure_range(category=SERIES_RANGE)
    return chart.properties(height=height) if height else chart
