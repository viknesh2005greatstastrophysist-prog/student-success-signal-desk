"""AURA visual components: the Apple-style design system (see docs/DESIGN_SYSTEM.md).

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
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import labels
import streamlit as st

ASSETS = Path(__file__).resolve().parent / "assets"
TONES = {"blue", "green", "orange", "red", "violet", "gray", "primary"}
NODE_ROLES = {"coordinator", "agent", "gate", "publish"}
STATE_TONES = {"green", "blue", "orange", "red", "gray"}
# Status tone -> the dot colour class used by `status_html` (violet is amber, like orange).
DOT_TONE = {
    "green": "green",
    "orange": "orange",
    "violet": "orange",
    "red": "red",
    "blue": "blue",
    "gray": "gray",
    "primary": "blue",
}

CSS = r"""
<style>
/* ==========================================================================
   AURA design system. Clear, quiet, Apple-like: content leads, the UI recedes.
   Tokens, base type, layout, sidebar, surfaces, controls, data, sign-in, motion.
   ========================================================================== */
:root {
  --bg: #F5F5F7; --surface: #FFFFFF; --fill: #E8E8ED; --fill-hover: #DEDEE3;
  --text: #1D1D1F; --text-2: #6E6E73; --text-3: #86868B;
  --sep: rgba(0, 0, 0, .08); --hair: rgba(0, 0, 0, .06); --field: rgba(0, 0, 0, .14);
  --blue: #0071E3; --blue-hover: #0077ED; --blue-press: #006EDB; --blue-tint: rgba(0, 113, 227, .12);
  --green: #34C759; --orange: #FF9F0A; --red: #FF3B30;
  --green-text: #1F8A3B; --orange-text: #A35F00; --red-text: #D70015;
  --font: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
  --ease: cubic-bezier(.25, .1, .25, 1);
  --radius: 18px; --radius-sm: 12px;
  --shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 8px 24px rgba(0, 0, 0, .04);
  --shadow-hover: 0 1px 2px rgba(0, 0, 0, .05), 0 12px 32px rgba(0, 0, 0, .08);
  --shadow-sheet: 0 1px 3px rgba(0, 0, 0, .05), 0 24px 56px rgba(0, 0, 0, .10);
}

/* ---- Base --------------------------------------------------------------- */
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
.stApp, [data-testid="stAppViewContainer"], [data-testid="stMain"] { background: var(--bg); color: var(--text); font-family: var(--font); }
[data-testid="stHeader"] { background: transparent; height: 3rem; }
[data-testid="stMainBlockContainer"] { max-width: 1040px; padding: 64px 48px 120px; }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] { gap: 24px; }
[data-testid="stMain"] [data-testid="stVerticalBlock"] { gap: 1.25rem; }
::selection { background: rgba(0, 113, 227, .22); color: var(--text); }
:focus-visible { outline: 2px solid var(--blue) !important; outline-offset: 2px; }
p, li, label, [data-testid="stMarkdownContainer"] { font-size: 17px; line-height: 1.47; letter-spacing: -.011em; }
a { color: var(--blue); text-underline-offset: 3px; }
strong, b { font-weight: 600; }

h1, h2, h3, h4, h5, h6 { font-family: var(--font) !important; font-weight: 600 !important; color: var(--text); text-transform: none; }
h1 { font-size: 36px !important; line-height: 1.1 !important; letter-spacing: -.022em !important; padding: 0 !important; margin: 0 !important; overflow-wrap: anywhere; }
h2 { font-size: 28px !important; line-height: 1.14 !important; letter-spacing: -.02em !important; padding: 0 !important; }
h3 { font-size: 24px !important; line-height: 1.17 !important; letter-spacing: -.018em !important; padding: 0 !important; margin: 32px 0 0 !important; }
h4 { font-size: 19px !important; line-height: 1.25 !important; letter-spacing: -.014em !important; padding: 0 !important; }
h5, h6 { font-size: 15px !important; letter-spacing: -.01em !important; color: var(--text-2); padding: 0 !important; margin: 0 !important; }
[data-testid="stCaptionContainer"], [data-testid="stCaptionContainer"] p, .stCaption, small { color: var(--text-2) !important; opacity: 1 !important; font-size: 13px; line-height: 1.4; letter-spacing: -.003em; }
[data-testid="stMarkdownContainer"]:has(h1, h2, h3, h4, h5, h6) { margin-bottom: 0 !important; }
[data-testid="stElementContainer"]:has(h1) + [data-testid="stElementContainer"]:has(.aura-subtitle) { margin-top: -14px; }
[data-testid="stElementContainer"]:has(h3) + [data-testid="stElementContainer"]:has([data-testid="stCaptionContainer"]) { margin-top: -12px; }
[data-testid="stElementContainer"]:has(h3) + [data-testid="stElementContainer"] [data-testid="stCaptionContainer"], [data-testid="stElementContainer"]:has(h3) + [data-testid="stElementContainer"] [data-testid="stCaptionContainer"] p { font-size: 15px; }
code, kbd, pre, [data-testid="stCode"] { font-family: var(--mono) !important; font-size: .86em; }
code { background: var(--bg); border-radius: 6px; padding: .1em .4em; color: var(--text); }
hr, [data-testid="stDivider"] hr { border: 0; border-top: 1px solid var(--sep); margin: 24px 0; }
.aura-num, [data-testid="stMetricValue"], [data-testid="stDataFrame"] { font-variant-numeric: tabular-nums; }
[data-testid="stIconMaterial"] { font-variation-settings: "FILL" 0, "wght" 300, "GRAD" 0, "opsz" 24; }

/* ---- Page header: large title, one secondary line -------------------------- */
.aura-subtitle { color: var(--text-2); font-size: 17px; line-height: 1.47; max-width: 62ch; margin: 8px 0 0 !important; }
.aura-eyebrow { font-size: 15px; font-weight: 600; color: var(--text-2); margin: 0 0 6px !important; letter-spacing: -.01em; }
.aura-plain { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 .5rem; }
.aura-plain-muted { color: var(--text-2); font-size: 13px; }

/* ---- Sidebar: light frosted glass ------------------------------------------ */
[data-testid="stSidebar"] { background: rgba(255, 255, 255, .72) !important; -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
  border-right: 1px solid var(--sep); }
[data-testid="stSidebarContent"] { display: flex; flex-direction: column; position: relative; background: transparent; }
[data-testid="stSidebarHeader"] { position: absolute; top: 12px; right: 8px; width: auto; height: auto; min-height: 0; padding: 0; margin: 0; z-index: 3; }
[data-testid="stSidebarHeader"] [data-testid="stLogoSpacer"] { display: none; }
[data-testid="stSidebarUserContent"], [data-testid="stSidebarUserContent"] > div,
[data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] { display: contents; }
[data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] > [data-testid="stElementContainer"]:nth-child(1) { order: 0; padding: 28px 24px 8px; }
[data-testid="stSidebarNav"] { order: 1; padding: 0 12px; max-height: none; }
[data-testid="stSidebarNavSeparator"] { display: none; }
[data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] > [data-testid="stElementContainer"]:nth-child(2) { order: 2; margin-top: auto; padding: 16px 24px 4px; }
[data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] > [data-testid="stElementContainer"]:nth-child(n+3) { order: 3; padding: 0 16px 20px; }
[data-testid="stSidebarNavItems"] { gap: 2px; padding: 0; }
[data-testid="stSidebarNavLink"] { border-radius: 10px; padding: 9px 12px; gap: 10px; color: var(--text); transition: background-color .2s var(--ease); }
[data-testid="stSidebarNavLink"] p { font-size: 15px; font-weight: 500; letter-spacing: -.01em; color: var(--text); }
[data-testid="stSidebarNavLink"] span, [data-testid="stSidebarNavLink"] p { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }
[data-testid="stSidebarNavLink"]:hover { background: rgba(0, 0, 0, .045); }
[data-testid="stSidebarNavLink"][aria-current="page"] { background: var(--fill); }
[data-testid="stSidebarNavLink"][aria-current="page"] p { font-weight: 600; }
[data-testid="stSidebarNavLink"] [data-testid="stIconMaterial"] { color: var(--text-2); font-size: 22px; }
[data-testid="stSidebarNavLink"][aria-current="page"] [data-testid="stIconMaterial"] { color: var(--text); }
[data-testid="stSidebar"] [data-testid="stBaseButton-secondary"] { background: transparent; color: var(--text-2); justify-content: flex-start; padding: 8px 12px; min-height: 0; font-size: 15px; font-weight: 500; }
[data-testid="stSidebar"] [data-testid="stBaseButton-secondary"] > div, [data-testid="stSidebar"] [data-testid="stBaseButton-secondary"] span { justify-content: flex-start; width: auto; }
[data-testid="stSidebar"] [data-testid="stBaseButton-secondary"]:hover { background: rgba(0, 0, 0, .045); color: var(--text); transform: none; box-shadow: none; }

.aura-brandbar { display: flex; align-items: center; gap: 10px; }
.aura-mark { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 8px; }
.aura-brandword { font-size: 19px; font-weight: 600; letter-spacing: .04em; color: var(--text); line-height: 1; }
.aura-id { display: flex; align-items: center; gap: 12px; padding-top: 14px; border-top: 1px solid var(--sep); }
.aura-avatar { flex: 0 0 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--text-2);
  font-size: 14px; font-weight: 600; letter-spacing: 0; }
.aura-id-name { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.25; overflow-wrap: anywhere; }
.aura-id-meta { font-size: 13px; color: var(--text-2); line-height: 1.3; }

/* ---- Surfaces: white, 18px radius, soft shadow, no hairline noise ----------- */
[class*="st-key-card_"] { background: var(--surface) !important; border: 1px solid var(--hair) !important; border-radius: var(--radius) !important;
  box-shadow: var(--shadow) !important; padding: 28px !important; gap: 16px !important;
  transition: transform .2s ease-out, box-shadow .2s ease-out; }
[class*="st-key-card_"]:not(:has(form, [data-testid="stDataFrame"], [data-testid="stDataFrameResizable"], iframe, canvas, button)):hover {
  transform: translateY(-1px); box-shadow: var(--shadow-hover) !important; }
[class*="st-key-card_"] [data-testid="stForm"], [class*="st-key-gate_"] [data-testid="stForm"] { background: transparent; border: 0; padding: 0; box-shadow: none; }
/* Cards in a row share one height. */
[data-testid="stColumn"] > [data-testid="stVerticalBlock"]:has(> [data-testid="stLayoutWrapper"]:only-child) { height: 100%; }
[data-testid="stColumn"] > [data-testid="stVerticalBlock"] > [data-testid="stLayoutWrapper"]:only-child { flex: 1 1 auto; display: flex; flex-direction: column; }
[data-testid="stLayoutWrapper"]:only-child > [class*="st-key-"] { flex: 1 1 auto; }
[data-testid="stForm"] { border: 0 !important; padding: 0 !important; background: transparent; }

/* ---- Figures: a few numbers that earn their place, in one quiet card -------- */
[class*="st-key-kpis_"] { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--hair); padding: 26px 8px; }
[class*="st-key-kpis_"] [data-testid="stHorizontalBlock"] { gap: 0; }
[class*="st-key-kpis_"] [data-testid="stColumn"] { padding: 0 28px; min-width: 0; }
[class*="st-key-kpis_"] [data-testid="stColumn"] + [data-testid="stColumn"] { border-left: 1px solid var(--sep); }
[data-testid="stMetric"] { background: transparent; border: 0; box-shadow: none; padding: 0 !important; min-height: 0; }
[data-testid="stMetric"] > div { gap: 6px; }
[data-testid="stMetricLabel"], [data-testid="stMetricLabel"] p { color: var(--text-2); font-size: 15px !important; font-weight: 400 !important; letter-spacing: -.01em;
  line-height: 1.3; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; text-transform: none; }
[data-testid="stMetricLabel"] > div { align-items: flex-start; gap: 8px; min-width: 0; }
[data-testid="stMetricLabel"] [data-testid="stTooltipIcon"], [data-testid="stMetricLabel"] svg { flex: 0 0 auto; width: 15px; height: 15px; }
[data-testid="stMetricLabel"] [data-testid="stMetricIcon"], [data-testid="stMetricLabel"] > div > span:first-child:not([data-testid]) { display: none; }
[data-testid="stMetricValue"], [data-testid="stMetricValue"] * { font-family: var(--font) !important; font-weight: 600 !important; font-size: 34px; line-height: 1.1;
  letter-spacing: -.022em; color: var(--text); font-variant-numeric: tabular-nums; white-space: normal !important; overflow: visible !important;
  text-overflow: clip !important; overflow-wrap: break-word; word-break: normal; }
[data-testid="stMetricDelta"] { font-size: 13px; }

/* ---- Notices, empty states, insight ------------------------------------------ */
.aura-gate, .aura-insight { display: flex; gap: 14px; align-items: flex-start; padding: 20px 24px; border-radius: var(--radius); background: var(--surface);
  border: 1px solid var(--hair); box-shadow: var(--shadow); }
.aura-gate-title, .aura-insight-title { font-size: 17px; font-weight: 600; line-height: 1.3; color: var(--text); letter-spacing: -.011em; }
.aura-gate-text, .aura-insight-text { color: var(--text-2); font-size: 15px; margin-top: 2px; max-width: 70ch; line-height: 1.45; }
.aura-dotmark { flex: 0 0 8px; width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: var(--orange); display: inline-block; }
.aura-dotmark.gray { background: var(--text-3); }
.aura-empty { padding: 48px 24px; text-align: center; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hair); }
.aura-empty-title { font-size: 17px; font-weight: 600; color: var(--text); }
.aura-empty-hint { color: var(--text-2); font-size: 15px; margin: 4px auto 0; max-width: 52ch; }

/* ---- Status: a small dot and a word -------------------------------------------- */
.aura-status { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--text-2); white-space: nowrap; letter-spacing: -.01em; }
.aura-status i { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex: 0 0 8px; }
.aura-status.green i { background: var(--green); } .aura-status.orange i { background: var(--orange); }
.aura-status.red i { background: var(--red); } .aura-status.blue i { background: var(--blue); }
.stMarkdownBadge { background: transparent !important; border-radius: 0 !important; padding: 0 !important; margin-right: 14px; font-family: var(--font); font-size: 15px !important;
  font-weight: 500; letter-spacing: -.01em; display: inline-block !important; white-space: nowrap; }
.stMarkdownBadge::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; margin-right: 7px; vertical-align: 1px; }
.stMarkdownBadge span[role="img"] { display: none; }

/* ---- Provenance: quiet, with a small sparkle ------------------------------------- */
.aura-prov { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); line-height: 1.4; margin: 0; }
.aura-prov::before { content: ""; width: 14px; height: 14px; flex: 0 0 14px; background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2c.6 4.9 2.9 8.4 10 10-7.100 1.600-9.400 5.100-10 10-.6-4.900-2.900-8.400-10-10 7.100-1.600 9.400-5.100 10-10z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2c.6 4.9 2.9 8.4 10 10-7.100 1.600-9.400 5.100-10 10-.6-4.900-2.900-8.400-10-10 7.100-1.600 9.400-5.100 10-10z'/%3E%3C/svg%3E") center / contain no-repeat; }
.aura-prov-note { color: var(--text-3); }
.aura-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; font-size: 13px; color: var(--text-2); margin: 2px 0; }

/* ---- Evidence and signals: grouped rows, never chips ------------------------------ */
.aura-claim { margin: 12px 0 4px; line-height: 1.47; color: var(--text); }
.aura-chips { display: block; margin: 8px 0 4px; background: var(--bg); border-radius: 12px; overflow: hidden; }
.aura-chip { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 10px 16px; font-size: 15px; max-width: 100%; }
.aura-chip + .aura-chip { border-top: 1px solid var(--sep); }
.aura-chip-k { color: var(--text-2); overflow-wrap: anywhere; }
.aura-chip-v { color: var(--text); font-weight: 500; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.aura-signals { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 2px 0 4px; }
.aura-signal { font-size: 15px; color: var(--text-2); }

/* ---- Inset grouped lists: rows separated by hairlines inside one rounded card ------ */
.aura-list, [class*="st-key-list_"] { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--hair); overflow: hidden; gap: 0 !important; }
.aura-list.flat { background: var(--bg); box-shadow: none; border: 0; border-radius: 14px; }
.aura-item { display: flex; align-items: center; gap: 16px; padding: 16px 24px; position: relative; min-width: 0; }
.aura-item + .aura-item::before, [class*="st-key-list_"] [data-testid="stLayoutWrapper"] + [data-testid="stLayoutWrapper"] .aura-item::before {
  content: ""; position: absolute; top: 0; left: 24px; right: 0; height: 1px; background: var(--sep); }
.aura-item-main { flex: 1 1 auto; min-width: 0; }
.aura-item-title { font-size: 17px; font-weight: 500; color: var(--text); letter-spacing: -.011em; line-height: 1.3; overflow-wrap: anywhere; }
.aura-item-sub { font-size: 15px; color: var(--text-2); line-height: 1.4; margin-top: 2px; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.aura-item-end { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; color: var(--text-2); font-size: 15px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.aura-chev { width: 8px; height: 14px; background: #C7C7CC; flex: 0 0 8px;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 14'%3E%3Cpath d='M1 1l6 6-6 6' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 14'%3E%3Cpath d='M1 1l6 6-6 6' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
.aura-item.kv { justify-content: space-between; gap: 24px; }
.aura-item.kv .k { color: var(--text-2); font-size: 15px; }
.aura-item.kv .v { color: var(--text); font-size: 17px; text-align: right; overflow-wrap: anywhere; min-width: 0; }
.aura-bar { width: 96px; height: 4px; border-radius: 4px; background: var(--fill); overflow: hidden; flex: 0 0 96px; }
.aura-bar > i { display: block; height: 100%; background: var(--blue); border-radius: 4px; }
/* A whole row is one tap target: the button sits invisibly on top of it. */
[class*="st-key-row_"] { position: relative; gap: 0 !important; transition: background-color .2s ease-out; }
[class*="st-key-row_"]:hover { background: #FAFAFC; }
[class*="st-key-row_"] [data-testid="stElementContainer"]:has(button) { position: absolute; inset: 0; z-index: 2; width: 100% !important; height: 100% !important; }
[class*="st-key-row_"] .stButton, [class*="st-key-row_"] .stButton > div { width: 100%; height: 100%; }
[class*="st-key-row_"] button { width: 100%; height: 100%; opacity: 0; cursor: pointer; border-radius: 0; }
[class*="st-key-row_"]:has(button:focus-visible) { outline: 2px solid var(--blue); outline-offset: -2px; }

/* ---- The next decision: one calm card ------------------------------------------------ */
.aura-feature-kicker { font-size: 15px; font-weight: 500; color: var(--text-2); margin: 0 0 6px; }
.aura-feature-title { font-size: 28px; font-weight: 600; letter-spacing: -.02em; line-height: 1.14; color: var(--text); margin: 0; overflow-wrap: anywhere; }
.aura-feature-text { font-size: 17px; color: var(--text-2); line-height: 1.47; margin: 10px 0 0; max-width: 60ch;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.aura-feature-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 14px 0 4px; font-size: 15px; color: var(--text-2); }
[class*="st-key-card_next"] { padding: 32px !important; gap: 20px !important; }

/* ---- The sheet: approve this plan? ------------------------------------------------------ */
[class*="st-key-gate_"] { background: var(--surface) !important; border: 1px solid var(--hair) !important; border-radius: 24px !important;
  box-shadow: var(--shadow-sheet) !important; padding: 40px 44px !important; gap: 16px !important; }
.aura-sheet-title { font-size: 28px; font-weight: 600; letter-spacing: -.02em; line-height: 1.14; color: var(--text); margin: 0; }
.aura-sheet-sub { font-size: 17px; color: var(--text-2); margin: 4px 0 0; }
.aura-sheet-h { font-size: 15px; font-weight: 600; color: var(--text-2); margin: 24px 0 8px; letter-spacing: -.01em; }
.aura-sheet-p { font-size: 17px; color: var(--text); line-height: 1.5; margin: 14px 0 0; overflow-wrap: anywhere; max-width: 64ch; }
.aura-ref { font-size: 13px; color: var(--text-3); line-height: 1.5; margin: 4px 0 0; overflow-wrap: anywhere; }
.aura-ref .hash { font-family: var(--mono); font-size: 12px; }
[class*="st-key-gate_"] [data-testid="stForm"] { max-width: none; }
[class*="st-key-danger"] button { background: transparent !important; color: var(--red-text) !important; box-shadow: none !important; }
[class*="st-key-danger"] button:hover { background: rgba(255, 59, 48, .08) !important; transform: none !important; }

/* ---- Controls ---------------------------------------------------------------------------- */
[data-testid="stBaseButton-secondary"], [data-testid="stBaseButton-primary"], [data-testid="stBaseButton-tertiary"],
[data-testid="stBaseButton-secondaryFormSubmit"], [data-testid="stBaseButton-primaryFormSubmit"], [data-testid="stBaseButton-tertiaryFormSubmit"] {
  font-family: var(--font); font-weight: 500; font-size: 17px; letter-spacing: -.011em; min-height: 48px; height: auto; border-radius: 980px; padding: 12px 22px; border: 0;
  transition: transform .2s ease-out, background-color .2s ease-out, color .2s ease-out, box-shadow .2s ease-out; }
[data-testid="stBaseButton-secondary"] p, [data-testid="stBaseButton-primary"] p, [data-testid="stBaseButton-tertiary"] p,
[data-testid="stBaseButton-secondaryFormSubmit"] p, [data-testid="stBaseButton-primaryFormSubmit"] p, [data-testid="stBaseButton-tertiaryFormSubmit"] p {
  font-size: 17px; font-weight: 500; line-height: 1.3; white-space: normal; overflow: visible; text-overflow: clip; }
[data-testid="stBaseButton-primary"], [data-testid="stBaseButton-primaryFormSubmit"] { background: var(--blue); color: #fff; }
[data-testid="stBaseButton-primary"] p, [data-testid="stBaseButton-primaryFormSubmit"] p { color: #fff; }
[data-testid="stBaseButton-primary"]:hover, [data-testid="stBaseButton-primaryFormSubmit"]:hover { background: var(--blue-hover); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0, 113, 227, .28); }
[data-testid="stBaseButton-primary"]:active, [data-testid="stBaseButton-primaryFormSubmit"]:active { background: var(--blue-press); transform: scale(.98); box-shadow: none; }
[data-testid="stBaseButton-secondary"], [data-testid="stBaseButton-secondaryFormSubmit"] { background: var(--fill); color: var(--text); }
[data-testid="stBaseButton-secondary"]:hover, [data-testid="stBaseButton-secondaryFormSubmit"]:hover { background: var(--fill-hover); color: var(--text); transform: translateY(-1px); }
[data-testid="stBaseButton-secondary"]:active, [data-testid="stBaseButton-secondaryFormSubmit"]:active { transform: scale(.98); }
[data-testid="stBaseButton-tertiary"], [data-testid="stBaseButton-tertiaryFormSubmit"] { background: transparent; color: var(--blue); }
[data-testid="stBaseButton-tertiary"]:hover, [data-testid="stBaseButton-tertiaryFormSubmit"]:hover { background: var(--blue-tint); color: var(--blue); }
[data-testid="stBaseButton-secondary"]:disabled, [data-testid="stBaseButton-primary"]:disabled, [data-testid="stBaseButton-tertiary"]:disabled,
[data-testid="stBaseButton-secondaryFormSubmit"]:disabled, [data-testid="stBaseButton-primaryFormSubmit"]:disabled { opacity: .4; transform: none; box-shadow: none; }

[data-baseweb="input"], [data-baseweb="base-input"], [data-baseweb="textarea"], [data-baseweb="select"] > div,
[data-testid="stTextInputRootElement"], [data-testid="stTextAreaRootElement"], [data-testid="stNumberInputContainer"], [data-testid="stDateInputField"], [data-testid="stTimeInputField"] {
  background: var(--surface) !important; border-radius: 12px !important; border: 1px solid var(--field) !important; transition: border-color .2s ease-out, box-shadow .2s ease-out; }
[data-testid="stTextInputRootElement"] [data-baseweb], [data-testid="stTextAreaRootElement"] [data-baseweb], [data-testid="stNumberInputContainer"] [data-baseweb] { border: 0 !important; box-shadow: none !important; background: transparent !important; }
[data-baseweb="input"]:focus-within, [data-baseweb="textarea"]:focus-within, [data-baseweb="select"] > div:focus-within, [data-testid="stTextInputRootElement"]:focus-within,
[data-testid="stTextAreaRootElement"]:focus-within, [data-testid="stNumberInputContainer"]:focus-within, [data-testid="stDateInputField"]:focus-within { border-color: var(--blue) !important;
  box-shadow: 0 0 0 4px rgba(0, 113, 227, .18) !important; }
[data-testid="stExpanderIcon"], [data-testid="stCaptionContainer"] span[role="img"], [data-testid="stCaptionContainer"] [data-testid="stIconMaterial"],
[data-testid="stMain"] [data-testid^="stBaseButton"] [data-testid="stIconMaterial"], [data-testid="stHeaderActionElements"] { display: none !important; }
[data-baseweb="input"] input, [data-baseweb="textarea"] textarea { font-family: var(--font); font-size: 17px; letter-spacing: -.011em; }
[data-baseweb="input"] input { min-height: 28px; }
[data-testid="stWidgetLabel"], [data-testid="stWidgetLabel"] p { font-size: 15px; font-weight: 500; color: var(--text-2); letter-spacing: -.01em; }
[data-testid="stSelectbox"] [data-baseweb="select"] div[value], [data-testid="stSelectbox"] [data-baseweb="select"] span { white-space: normal; overflow-wrap: anywhere; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div { min-height: 48px; height: auto; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div > div:first-child { padding-top: 4px; padding-bottom: 4px; }
[data-baseweb="popover"] [role="listbox"], [data-baseweb="menu"] { border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, .14); border: 1px solid var(--hair); }

/* Segmented controls, iOS style: a grey track, a white raised thumb. */
[data-testid="stButtonGroup"] [role="radiogroup"], [data-testid="stButtonGroup"] [role="group"] { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; background: rgba(118, 118, 128, .12); border-radius: 10px; max-width: 100%; }
[data-testid="stButtonGroup"] button { border: 0 !important; border-radius: 8px !important; background: transparent !important; color: var(--text) !important; box-shadow: none !important;
  min-height: 34px; padding: 4px 16px; font-size: 15px; font-weight: 500; letter-spacing: -.01em; transition: background-color .2s ease-out, box-shadow .2s ease-out; }
[data-testid="stButtonGroup"] button p { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: visible; text-overflow: clip; }
[data-testid="stButtonGroup"] button:hover { background: rgba(0, 0, 0, .04) !important; }
[data-testid="stButtonGroup"] button[aria-checked="true"], [data-testid="stButtonGroup"] button[data-selected="true"], [data-testid="stButtonGroup"] button[aria-pressed="true"],
[data-testid="stButtonGroup"] button[kind*="Active"], [data-testid="stButtonGroup"] button[data-testid*="Active"] { background: var(--surface) !important; font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 3px 8px rgba(0, 0, 0, .06) !important; }
[data-testid="stButtonGroup"] [data-testid="stMarkdownContainer"] p { white-space: nowrap; }

[data-testid="stMain"] [data-testid="stRadio"] [role="radiogroup"] { gap: 8px 24px; }
[data-testid="stCheckbox"] label, [data-testid="stToggle"] label { font-size: 17px; }

[data-testid="stExpander"] details { background: var(--surface); border: 1px solid var(--hair); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
[data-testid="stExpander"] details > summary { position: relative; padding: 16px 48px 16px 20px; font-weight: 500; font-size: 17px; list-style: none; transition: background-color .2s ease-out; }
[data-testid="stExpander"] details > summary svg, [data-testid="stExpander"] details > summary [data-testid="stExpanderToggleIcon"] { display: none !important; }
[data-testid="stExpander"] details > summary > span { gap: 0 !important; }
[data-testid="stExpander"] details > summary::after { content: ""; position: absolute; right: 24px; top: 50%; width: 7px; height: 7px; border-right: 2px solid var(--text-3); border-bottom: 2px solid var(--text-3);
  transform: translateY(-70%) rotate(45deg); transition: transform .2s ease-out; }
[data-testid="stExpander"] details[open] > summary::after { transform: translateY(-30%) rotate(-135deg); }
[data-testid="stExpander"] details > summary:hover { background: #FAFAFC; }
[data-testid="stExpander"] details > summary p { overflow-wrap: anywhere; white-space: normal; font-size: 17px; font-weight: 500; }
[data-testid="stExpanderDetails"] { padding: 4px 20px 20px; }
[class*="st-key-gate_"] [data-testid="stExpander"] details { box-shadow: none; background: var(--bg); border: 0; }
[class*="st-key-gate_"] [data-testid="stExpander"] details > summary:hover { background: #EDEDF0; }

[data-testid="stAlert"] { background: var(--surface) !important; border: 1px solid var(--hair) !important; border-radius: 14px !important; box-shadow: var(--shadow); color: var(--text) !important; }
[data-testid="stAlert"] [data-testid="stAlertContainer"] { background: transparent; padding: 16px 20px; }
[data-testid="stAlert"] p { color: var(--text); font-size: 15px; }
[data-testid="stAlert"]:has([data-testid="stAlertContentInfo"]) [data-testid="stIconMaterial"], [data-testid="stAlert"]:has([data-testid="stAlertContentInfo"]) svg { color: var(--text-2); fill: var(--text-2); }
[data-testid="stAlert"]:has([data-testid="stAlertContentSuccess"]) [data-testid="stIconMaterial"] { color: var(--green-text); }
[data-testid="stAlert"]:has([data-testid="stAlertContentWarning"]) [data-testid="stIconMaterial"] { color: var(--orange-text); }
[data-testid="stAlert"]:has([data-testid="stAlertContentError"]) [data-testid="stIconMaterial"] { color: var(--red-text); }

[data-testid="stProgress"] [role="progressbar"] { height: 4px; border-radius: 999px; background: var(--fill); }
[data-testid="stProgress"] [role="progressbar"] > div { background: var(--blue); border-radius: 999px; }
[data-testid="stProgress"] p { font-size: 15px; color: var(--text-2); font-variant-numeric: tabular-nums; }

[data-testid="stDataFrame"], [data-testid="stDataFrameResizable"] { border: 1px solid var(--hair); border-radius: 14px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow); }
[data-testid="stArrowVegaLiteChart"], [data-testid="stVegaLiteChart"] { background: transparent; }
[data-testid="stElementToolbar"] { top: -4px; }
[data-testid="stCode"] pre, [data-testid="stCode"] { background: var(--bg) !important; border-radius: 10px; }
[data-testid="stToast"], [data-testid="stToastContainer"] [data-baseweb="toast"] { border-radius: 14px; border: 1px solid var(--hair); box-shadow: 0 12px 40px rgba(0, 0, 0, .14); }
[data-testid="stPopover"] button { border-radius: 980px; }
[data-testid="stSpinner"] { font-size: 15px; color: var(--text-2); }
[data-testid="stMain"] [data-testid="stForm"] { max-width: 860px; }
[data-testid="stMain"] [data-testid="stExpanderDetails"] [data-testid="stForm"] { max-width: none; }
[data-baseweb="tag"] { background: var(--fill) !important; color: var(--text) !important; border-radius: 999px !important; border: 0; height: auto !important; padding: 2px 4px 2px 10px; }
[data-baseweb="tag"] span { color: var(--text) !important; white-space: normal !important; max-width: none !important; font-size: 15px; }
[data-baseweb="tag"] svg { fill: var(--text-2); }
[data-testid="stElementContainer"]:has([data-testid="stVegaLiteChart"]) [data-testid="stElementToolbar"],
[data-testid="stElementContainer"]:has([data-testid="stArrowVegaLiteChart"]) [data-testid="stElementToolbar"] { display: none; }
[data-testid="stVegaLiteChart"] canvas, [data-testid="stVegaLiteChart"] svg { max-width: 100%; }
.aura-group { display: flex; align-items: baseline; gap: 12px; margin: 24px 0 8px; font-size: 15px; color: var(--text-2); }
.aura-group b { font-size: 22px; font-weight: 600; letter-spacing: -.018em; color: var(--text); }

/* ---- Tabs: quiet text, a thin underline ------------------------------------------------------ */
[data-baseweb="tab-list"] { gap: 28px; border-bottom: 1px solid var(--sep); background: transparent; flex-wrap: wrap; row-gap: 0; }
[data-baseweb="tab-border"], [data-baseweb="tab-highlight"] { display: none; }
[data-baseweb="tab"] { position: relative; background: transparent !important; padding: 12px 0 !important; margin: 0; height: auto; }
[data-baseweb="tab"] p, [data-baseweb="tab"] { font-size: 15px; font-weight: 500; color: var(--text-2); transition: color .2s ease-out; }
[data-baseweb="tab"]::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--text); opacity: 0; transition: opacity .2s ease-out; }
[data-baseweb="tab"]:hover { color: var(--text); }
[data-baseweb="tab"][aria-selected="true"], [data-baseweb="tab"][aria-selected="true"] p { color: var(--text); font-weight: 600; }
[data-baseweb="tab"][aria-selected="true"]::after { opacity: 1; }
[data-baseweb="tab-panel"] { padding-top: 24px; }

/* ---- Agent pipeline: a quiet stepper ---------------------------------------------------------- */
.aura-flow { --p: 0; position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; margin: 24px 0 8px; padding: 24px 12px;
  background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--hair); }
.aura-flow::before, .aura-flow::after { content: ""; position: absolute; top: 35px; left: 6%; right: 6%; height: 2px; border-radius: 2px; }
.aura-flow::before { background: var(--fill); }
.aura-flow::after { background: var(--text); transform-origin: left center; transform: scaleX(var(--p)); width: 88%; right: auto; }
.aura-node { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 0 2px; min-width: 0; }
.aura-pin { position: relative; width: 22px; height: 22px; border-radius: 50%; background: var(--surface); border: 2px solid #D1D1D6; display: grid; place-items: center; }
.aura-node.done .aura-pin { background: var(--text); border-color: var(--text); }
.aura-node.done .aura-pin::after { content: ""; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: translateY(-1px) rotate(45deg); }
.aura-node.running .aura-pin { border-color: var(--blue); }
.aura-node.running .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
.aura-node.waiting .aura-pin { border-color: var(--orange); }
.aura-node.waiting .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--orange); }
.aura-node.failed .aura-pin { border-color: var(--red); }
.aura-node.failed .aura-pin::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--red); }
.aura-node.gate .aura-pin { border-radius: 7px; }
.aura-node-body { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.aura-node-name { font-size: 11.5px; font-weight: 600; color: var(--text); line-height: 1.25; overflow-wrap: normal; word-break: normal; hyphens: manual; max-width: 100%; letter-spacing: -.01em; }
.aura-node-state:empty { display: none; }
.aura-node-state { font-size: 13px; color: var(--text-2); }
.aura-node.failed .aura-node-state { color: var(--red-text); }
.aura-node-note { font-size: 12px; color: var(--text-3); line-height: 1.3; }
.aura-subs { display: grid; gap: 2px; }
.aura-sub { font-size: 12px; color: var(--text-2); display: flex; gap: 5px; align-items: center; justify-content: center; }
.aura-dot { width: 7px; height: 7px; border-radius: 50%; background: #D1D1D6; display: inline-block; flex: 0 0 7px; }
.aura-dot.green { background: var(--green); } .aura-dot.blue { background: var(--blue); }
.aura-dot.orange { background: var(--orange); } .aura-dot.red { background: var(--red); }
.aura-legend { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 13px; color: var(--text-2); margin: 8px 0 0; }
.aura-legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #D1D1D6; }
.aura-legend .done::before { background: var(--text); } .aura-legend .waiting::before { background: var(--orange); }
.aura-legend .failed::before { background: var(--red); }

/* ---- Sign-in: a calm, centred card ---------------------------------------------------------------- */
.st-key-login_shell { display: flex !important; flex-direction: column; align-items: center; justify-content: center; min-height: 100dvh; padding: 40px 16px; background: var(--bg); gap: 0 !important; }
.st-key-login_shell > [data-testid="stLayoutWrapper"], .st-key-login_shell > [data-testid="stElementContainer"] { width: 100%; max-width: 480px; }
.st-key-login_panel { width: 100%; background: var(--surface); border-radius: 24px; box-shadow: var(--shadow-sheet); border: 1px solid var(--hair); padding: 48px 40px 36px; gap: 20px !important; }
.aura-login-head { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; margin-bottom: 4px; }
.aura-login-head .aura-mark { width: 52px; height: 52px; flex-basis: 52px; border-radius: 13px; margin-bottom: 10px; }
.aura-login-word { font-size: 30px; font-weight: 600; letter-spacing: .03em; color: var(--text); line-height: 1.1; margin: 0; }
.aura-login-tag { font-size: 17px; color: var(--text-2); margin: 0; }
.st-key-login_panel [data-testid="stButtonGroup"], .st-key-login_panel [data-testid="stButtonGroup"] > div, .st-key-login_panel [data-testid="stElementContainer"]:has([data-testid="stButtonGroup"]) { width: 100% !important; }
.st-key-login_panel [data-testid="stButtonGroup"] [role="radiogroup"] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; }
.st-key-login_panel [data-testid="stButtonGroup"] button { width: 100%; justify-content: center; padding: 4px 6px; }
.st-key-login_panel [data-testid="stButtonGroup"] button p { font-size: 14px; overflow: visible; text-overflow: clip; }
.st-key-login_panel [data-testid="stButtonGroup"] button { min-height: 38px; }
.st-key-login_panel [data-baseweb="input"], .st-key-login_panel [data-baseweb="base-input"], .st-key-login_panel [data-testid="stTextInputRootElement"] { min-height: 50px; border-radius: 14px !important; }
.st-key-login_panel [data-baseweb="input"] input { min-height: 36px; padding-top: 8px; padding-bottom: 8px; }
.st-key-login_panel [data-testid="stBaseButton-primaryFormSubmit"] { width: 100%; min-height: 52px; justify-content: center; }
.st-key-login_panel [data-testid="stCaptionContainer"] { text-align: center; color: var(--text-3); }
.st-key-login_panel [data-testid="stCheckbox"] label p { font-size: 15px; color: var(--text-2); }
.st-key-login_panel [data-testid="stBaseButton-secondary"] { width: 100%; min-height: 48px; justify-content: center; border-radius: 14px; }
.st-key-cookie_sink { display: none !important; }
/* Test accounts: this computer only (local_accounts.py). Quiet, below the card. */
.st-key-login_local { width: 100%; margin-top: 16px; padding: 20px 20px 16px; border: 1px solid var(--hair); border-radius: 20px; gap: 10px !important; }
.st-key-login_local [data-testid="stCaptionContainer"] { text-align: center; color: var(--text-3); }
.st-key-login_local [data-testid="stBaseButton-secondary"] { width: 100%; min-height: 38px; padding: 0 8px; justify-content: center; border-radius: 12px; }
.st-key-login_local [data-testid="stBaseButton-secondary"] p { display: block; font-size: 13px; line-height: 1.2; margin: 0; white-space: nowrap; overflow: visible; text-overflow: clip; }
.st-key-login_local [data-testid="stBaseButton-secondary"] [data-testid="stMarkdownContainer"] { margin: 0; }
.aura-local-title { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); text-align: center; margin: 0; }

/* ---- Motion: content fades in over 250ms; hover lifts 1px; nothing bounces ----------------------------- */
@keyframes aura-fade { from { opacity: 0; } }
[data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > * { animation: aura-fade .25s ease-out backwards; }

/* ---- Small screens ----------------------------------------------------------------------------------------- */
@media (max-width: 880px) { [data-testid="stMainBlockContainer"] { padding: 56px 24px 96px; } }
@media (max-width: 640px) {
  [data-testid="stMainBlockContainer"] { padding: 56px 16px 80px; }
  h1 { font-size: 30px !important; }
  h3 { font-size: 22px !important; margin-top: 24px !important; }
  [data-testid="stButtonGroup"] button { padding: 4px 10px; }
  [class*="st-key-card_"] { padding: 20px !important; }
  [class*="st-key-card_next"] { padding: 24px !important; }
  [class*="st-key-gate_"] { padding: 24px 20px !important; border-radius: 20px !important; }
  .aura-feature-title, .aura-sheet-title { font-size: 24px; }
  .aura-item { padding: 14px 16px; gap: 12px; }
  .aura-item-end .aura-status { display: none; }
  .aura-item-end .aura-bar { display: none; }
  [class*="st-key-kpis_"] { padding: 18px 4px; }
  [class*="st-key-kpis_"] [data-testid="stHorizontalBlock"] { flex-direction: row !important; flex-wrap: wrap !important; row-gap: 18px; }
  [class*="st-key-kpis_"] [data-testid="stColumn"] { flex: 1 1 50% !important; min-width: 50% !important; width: 50% !important; padding: 0 16px; border-left: 0 !important; }
  [data-testid="stMetricValue"], [data-testid="stMetricValue"] * { font-size: 28px; }
  .st-key-login_shell { padding: 16px 12px; justify-content: flex-start; }
  .st-key-login_panel [data-testid="stButtonGroup"] [role="radiogroup"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .st-key-login_panel { padding: 32px 22px 28px; border-radius: 22px; }
  .aura-flow { grid-auto-flow: row; grid-auto-columns: 1fr; gap: 14px; padding: 20px; }
  .aura-flow::before, .aura-flow::after { top: 30px; bottom: 30px; left: 30px; right: auto; width: 2px; height: auto; }
  .aura-flow::after { transform: scaleY(var(--p)); transform-origin: top center; width: 2px; }
  .aura-node { flex-direction: row; align-items: flex-start; text-align: left; gap: 12px; }
  .aura-node > .aura-pin { flex: 0 0 22px; }
  .aura-node-body { align-items: flex-start; }
  .aura-sub { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
</style>
"""

STYLES = CSS
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
    """Inline SVG is sanitised away by st.html, so graphics travel as data-URI images."""
    data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f'<img class="{css}" alt="{esc(alt)}" src="data:image/svg+xml;base64,{data}" />'


MARK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<rect width="64" height="64" rx="15" fill="#1D1D1F"/>'
    '<path d="M17 47 L32 21 L47 47" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    '<circle cx="32" cy="17" r="5.5" fill="#0071E3"/></svg>'
)


def brand() -> None:
    st.sidebar.html(
        f'<div class="aura-brandbar">{_svg_img(MARK_SVG, css="aura-mark", alt="AURA")}<span class="aura-brandword">AURA</span></div>'
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


TITLES = {"dr", "prof", "mr", "ms", "mrs", "shri", "smt"}


def initials(name: Any) -> str:
    parts = [p for p in str(name or "").replace(".", " ").split() if p[:1].isalpha()]
    if not parts:
        return "A"
    if parts[0].lower() in TITLES and len(parts) > 1:
        parts = parts[1:]
    letters = parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")
    return letters.upper()


def first_name(name: Any, fallback: str = "there") -> str:
    """The first given name, skipping a title such as Dr or Prof."""
    parts = [p for p in str(name or "").replace(".", " ").split() if p[:1].isalpha()]
    if parts and parts[0].lower() in TITLES and len(parts) > 1:
        parts = parts[1:]
    return parts[0].title() if parts else fallback


def greeting() -> str:
    """Good morning, afternoon or evening, in the college's time zone."""
    hour = datetime.now(ZoneInfo("Asia/Kolkata")).hour
    return "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"


def identity_card(name: Any, role_label: str, detail: Any) -> None:
    st.sidebar.html(
        f"""<div class="aura-id" title="{esc(detail)}"><div class="aura-avatar" aria-hidden="true">{esc(initials(name))}</div>
        <div><div class="aura-id-name">{esc(name)}</div><div class="aura-id-meta">{esc(role_label)}</div></div></div>"""
    )


def page_header(
    title: str,
    subtitle: str | None = None,
    eyebrow: str | None = None,
    em: str | None = None,
) -> None:
    """A large title and one secondary line. ``eyebrow`` and ``em`` are accepted for
    compatibility and ignored: the page title says where you are."""
    st.title(_md_escape(title), anchor=False)
    if subtitle:
        st.html(f'<p class="aura-subtitle">{esc(subtitle)}</p>')


def section(title: str, caption: str | None = None, icon: str | None = None) -> None:
    st.subheader(title, anchor=False)
    if caption:
        st.caption(caption)


@contextmanager
def card(key: str, *, height: Any = "content"):
    with st.container(border=True, key=f"card_{key}", height=height):
        yield


def kpi_row(items: Sequence[dict[str, Any]]) -> None:
    """A few figures in one quiet card. items: {label, value, help?, delta?, delta_color?, chart?}.

    Only show a figure that tells the reader something; ``icon`` and ``signal`` are
    accepted for compatibility and ignored."""
    if not items:
        return
    _KPI_SEQ["n"] += 1
    with st.container(key=f"kpis_c{len(items)}_{_KPI_SEQ['n']}"):
        cols = st.columns(len(items))
        for col, item in zip(cols, items):
            with col:
                st.metric(
                    item["label"],
                    item["value"],
                    delta=item.get("delta"),
                    delta_color=item.get("delta_color", "normal"),
                    help=item.get("help"),
                    border=False,
                    chart_data=item.get("chart"),
                    chart_type=item.get("chart_type", "area"),
                )


def kpi_row_nonzero(items: Sequence[dict[str, Any]]) -> None:
    """Like kpi_row, but the first figure always shows and a zero elsewhere is left out."""
    keep = [i for n, i in enumerate(items) if n == 0 or str(i.get("value")) not in {"0", "—", ""}]
    kpi_row(keep)


def status_html(label: Any, tone: str = "gray") -> str:
    """A small status dot and a word. Escaped markup."""
    dot = DOT_TONE.get(tone, "gray")
    return f'<span class="aura-status {dot}"><i></i>{esc(label)}</span>'


def badge_md(label: Any, tone: str = "gray", icon: str = "") -> str:
    """Streamlit badge, restyled to a dot and a word. ``icon`` is accepted and ignored."""
    tone = tone if tone in TONES else "gray"
    return f":{tone}-badge[{_md_safe(label)}]"


def status_md(code: Any) -> str:
    return badge_md(labels.status_label(code), labels.status_tone(code))


def risk_md(band: Any, score: Any = None) -> str:
    label, tone, _icon = labels.RISK_BANDS.get(
        str(band or "not evaluated"), (labels.humanize(band), "gray", "")
    )
    suffix = f" · {score}" if score is not None else ""
    return badge_md(f"{label}{suffix}", tone)


def status_badge(code: Any) -> None:
    st.markdown(status_md(code))


def provenance(note: str = "Drafted by AI · checked by your mentor", extra: str = "") -> str:
    """The quiet AI provenance line. Escaped markup."""
    more = f' <span class="aura-prov-note">· {esc(extra)}</span>' if extra else ""
    return f'<p class="aura-prov">{esc(note)}{more}</p>'


def provenance_caption(
    note: str = "Drafted by AI · checked by your mentor", extra: str = "", model_id: Any = None
) -> None:
    name = labels.model_name(model_id)
    if name and note.startswith("Drafted by AI"):
        note = note.replace("Drafted by AI", f"Drafted by AI ({name})", 1)
    st.html(provenance(note, extra))


def agent_chip(model: Any = None, label: str = "agent") -> str:
    """Quiet provenance line for anything an AI produced. The model name stays in the
    tooltip; it is shown in full behind "How this was made". Returns escaped markup."""
    full = str(model or "").strip()
    text = "Scored by an AI judge" if label == "judge" else "Drafted by AI"
    return f'<span class="aura-prov" title="{esc(full) or "Produced by an AI model"}">{esc(text)}</span>'


def judge_scores_text(judge: Any) -> str:
    """Compact judge score: mean and one letter per dimension, e.g. '4.0/5 · G4 S3 A4 T5'."""
    if not isinstance(judge, dict) or judge.get("status") != "scored":
        return ""
    scores = judge.get("scores") or {}
    letters = " ".join(
        f"{name[0].upper()}{scores.get(name, '?')}" for name in labels.JUDGE_DIMENSIONS
    )
    return f"{judge.get('mean', '?')}/5 · {letters}"


def judge_chip(judge: Any) -> str:
    """Quiet line with the judge's compact score; the tooltip carries the reasons."""
    if not isinstance(judge, dict):
        return ""
    if judge.get("status") != "scored":
        return agent_chip("unavailable; the draft was not blocked", label="judge")
    reasons = judge.get("reasons") or {}
    scores = judge.get("scores") or {}
    detail = "; ".join(
        f"{labels.humanize(name)} {scores.get(name, '?')}: {reasons.get(name, '')}"
        for name in labels.JUDGE_DIMENSIONS
    )
    return agent_chip(f"{judge_scores_text(judge)}; {detail}", label="judge")


def judge_chip_block(judge: Any) -> None:
    """The mentor's compact judge line."""
    chip = judge_chip(judge)
    if not chip:
        return
    note = ""
    if isinstance(judge, dict) and judge.get("status") == "scored":
        previous = judge.get("previous")
        if isinstance(previous, dict) and previous.get("repair") == "applied":
            note = "repaired once after a low score, then scored again"
        elif judge.get("repair") == "discarded":
            note = "a repair was tried and not used; the earlier valid draft stands"
        elif judge.get("low"):
            note = "lowest: " + ", ".join(labels.humanize(n) for n in judge["low"])
        if judge.get("injected") or (isinstance(previous, dict) and previous.get("injected")):
            note = (note + " · " if note else "") + "a score was injected for testing"
    score = judge_scores_text(judge) if isinstance(judge, dict) else ""
    extra = f'<span class="aura-plain-muted">{esc(" · ".join(p for p in (score, note) if p))}</span>'
    st.html(f'<div class="aura-meta">{chip}{extra}</div>')


def agent_chip_block(model: Any = None, label: str = "agent", note: str = "") -> None:
    extra = f'<span class="aura-plain-muted">{esc(note)}</span>' if note else ""
    st.html(f'<div class="aura-meta">{agent_chip(model, label)}{extra}</div>')


def gate_banner(text: str, title: str = "Human gate") -> None:
    st.html(
        f"""<div class="aura-gate" role="note"><span class="aura-dotmark" aria-hidden="true"></span>
        <div><div class="aura-gate-title">{esc(title)}</div><div class="aura-gate-text">{esc(text)}</div></div></div>"""
    )


def sheet_header(title: str, subtitle: str = "") -> None:
    sub = f'<p class="aura-sheet-sub">{esc(subtitle)}</p>' if subtitle else ""
    st.html(f'<div><p class="aura-sheet-title" role="heading" aria-level="2">{esc(title)}</p>{sub}</div>')


def sheet_heading(text: str) -> None:
    st.html(f'<p class="aura-sheet-h">{esc(text)}</p>')


def sheet_paragraph(text: Any) -> None:
    st.html(f'<p class="aura-sheet-p">{esc(text)}</p>')


def decision_head(version: Any, content_hash: Any) -> None:
    """Version and content hash of the draft being decided, in small tertiary text."""
    digest = str(content_hash or "")
    short = digest[:16] + ("…" if len(digest) > 16 else "")
    st.html(
        f'<p class="aura-ref">Version {esc(version)} · hash <span class="hash" title="{esc(digest)}">{esc(short)}</span></p>'
    )


def empty_state(title: str, hint: str = "", icon: str = "") -> None:
    """Quiet empty state. ``icon`` is accepted for compatibility and ignored: no emoji."""
    st.html(
        f"""<div class="aura-empty"><div class="aura-empty-title">{esc(title)}</div>
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
    """packet-v2 evidence rows: metric (and course), cited value and threshold.
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
            f'<div class="aura-chip" tabindex="0" title="{esc(heading)}: {esc(text)} ({esc(path)})">'
            f'<span class="aura-chip-k">{esc(heading)}</span><span class="aura-chip-v">{esc(text)}</span></div>'
        )
    return f'<div class="aura-chips">{"".join(chips)}</div>' if chips else ""


def signal_chips(signals: Iterable[dict[str, Any]]) -> str:
    chips = "".join(
        f'<span class="aura-signal">{esc(labels.signal_label(s.get("code")))}</span>'
        for s in signals
    )
    return f'<div class="aura-signals">{chips}</div>' if chips else ""


def html_block(markup: str) -> None:
    """For markup assembled exclusively from esc()-escaped values. Empty markup (for
    example a student with a score but no signals) draws nothing; st.html refuses it."""
    if markup:
        st.html(markup)


# ---------------------------------------------------------------------------
# Lists: inset grouped rows. Rows are dicts:
#   title, sub (optional, two lines at most), status (label, tone) (optional),
#   end (optional secondary text), bar (optional 0-100 progress), chevron (bool)
# ---------------------------------------------------------------------------
def _item_html(row: dict[str, Any], *, chevron: bool = False) -> str:
    status = row.get("status")
    pieces = []
    if row.get("bar") is not None:
        pct = max(0.0, min(100.0, float(row["bar"])))
        pieces.append(f'<span class="aura-bar" aria-hidden="true"><i style="width:{pct:.0f}%"></i></span>')
    if status:
        pieces.append(status_html(status[0], status[1]))
    if row.get("end") not in (None, ""):
        pieces.append(f'<span>{esc(row["end"])}</span>')
    if chevron:
        pieces.append('<span class="aura-chev" aria-hidden="true"></span>')
    sub = f'<div class="aura-item-sub">{esc(row["sub"])}</div>' if row.get("sub") else ""
    return (
        f'<div class="aura-item"><div class="aura-item-main"><div class="aura-item-title">{esc(row.get("title"))}</div>{sub}</div>'
        f'<div class="aura-item-end">{"".join(pieces)}</div></div>'
    )


def inset_list(rows: Sequence[dict[str, Any]], *, flat: bool = False) -> None:
    """A read-only inset grouped list: hairline rows inside one rounded card."""
    if not rows:
        return
    body = "".join(_item_html(row) for row in rows)
    st.html(f'<div class="aura-list{" flat" if flat else ""}">{body}</div>')


def detail_list(pairs: Sequence[tuple[str, Any]]) -> None:
    """Label and value rows in one inset card (a profile, a receipt)."""
    rows = "".join(
        f'<div class="aura-item kv"><span class="k">{esc(label)}</span><span class="v">{esc(shown)}</span></div>'
        for label, shown in pairs
        if shown not in (None, "")
    )
    if rows:
        st.html(f'<div class="aura-list">{rows}</div>')


def row_list(key: str, rows: Sequence[dict[str, Any]]) -> int | None:
    """An inset list whose rows can be tapped. Returns the index of the tapped row, if any.

    Each row is a keyed container; an invisible button covers it so the whole row is the target."""
    tapped: int | None = None
    if not rows:
        return None
    with st.container(key=f"list_{key}"):
        for index, row in enumerate(rows):
            with st.container(key=f"row_{key}_{index}"):
                st.html(_item_html(row, chevron=True))
                if st.button(
                    str(row.get("action") or f"Open {row.get('title', '')}"),
                    key=f"rowbtn_{key}_{index}",
                ):
                    tapped = index
    return tapped


def feature_card(
    key: str,
    *,
    kicker: str,
    title: str,
    text: str = "",
    status: tuple[str, str] | None = None,
    meta: Sequence[str] = (),
    action: str | None = None,
) -> bool:
    """One calm card for the single most important thing. Returns True when the action is pressed."""
    pieces = [status_html(status[0], status[1])] if status else []
    pieces += [f"<span>{esc(m)}</span>" for m in meta if m]
    with st.container(key=f"card_{key}"):
        st.html(
            f'<div><p class="aura-feature-kicker">{esc(kicker)}</p>'
            f'<p class="aura-feature-title" role="heading" aria-level="2">{esc(title)}</p>'
            + (f'<p class="aura-feature-text">{esc(text)}</p>' if text else "")
            + (f'<div class="aura-feature-meta">{"".join(pieces)}</div>' if pieces else "")
            + "</div>"
        )
        return bool(action and st.button(action, type="primary", key=f"btn_{key}"))


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


# node state -> stepper class. "done" fills the node.
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
    trace: dict[str, Any] | None, *, empty_text: str = "Not reached", judge: Any = None
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
    specs.append(("PacketValidator", repair_note))
    if trace.get("JudgeAgent"):
        if isinstance(judge, dict) and judge.get("status") == "scored":
            judge_note = f'<div class="aura-node-note">{esc(judge_scores_text(judge))}</div>'
        elif isinstance(judge, dict):
            judge_note = '<div class="aura-node-note">unavailable, draft not blocked</div>'
        else:
            judge_note = ""
        specs.append(("JudgeAgent", judge_note))
    specs += [("HumanGate", ""), ("DashboardPublisher", "")]
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
        f"""<div class="aura-insight"><span class="aura-dotmark gray" aria-hidden="true"></span>
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
# Sign-in: a calm card on the page colour.
# ---------------------------------------------------------------------------
def login_head() -> None:
    st.html(
        f"""<div class="aura-login-head">{_svg_img(MARK_SVG, css="aura-mark", alt="")}
        <p class="aura-login-word" role="heading" aria-level="1">AURA</p>
        <p class="aura-login-tag">Every student, seen early.</p></div>"""
    )


# ---------------------------------------------------------------------------
# Charts (Altair): minimal. Faint horizontal guides, one accent series, grey labels.
# ---------------------------------------------------------------------------
RISK_DOMAIN = ["low", "medium", "high"]
RISK_RANGE = ["#34C759", "#FF9F0A", "#FF3B30"]
SERIES_RANGE = ["#0071E3", "#86868B", "#34C759", "#FF9F0A", "#FF3B30", "#1D1D1F"]


def style_chart(chart: Any, *, height: int | None = None) -> Any:
    """Apply the AURA chart look to an Altair chart (presentation only)."""
    chart = chart.configure(background="#FFFFFF", padding={"left": 8, "right": 12, "top": 12, "bottom": 4})
    chart = chart.configure_view(stroke=None)
    chart = chart.configure_axis(
        grid=True,
        gridColor="rgba(0,0,0,0.07)",
        gridWidth=1,
        domain=False,
        ticks=False,
        labelColor="#6E6E73",
        titleColor="#6E6E73",
        labelFont="Inter, -apple-system, system-ui, sans-serif",
        titleFont="Inter, -apple-system, system-ui, sans-serif",
        labelFontSize=12,
        titleFontSize=12,
        titleFontWeight=500,
        labelPadding=8,
    )
    chart = chart.configure_axisX(grid=False)
    chart = chart.configure_legend(
        labelColor="#6E6E73",
        titleColor="#6E6E73",
        labelFont="Inter, -apple-system, system-ui, sans-serif",
        titleFont="Inter, -apple-system, system-ui, sans-serif",
        labelFontSize=12,
        titleFontSize=12,
        orient="bottom",
        symbolType="circle",
        columns=0,
    )
    chart = chart.configure_range(category=SERIES_RANGE)
    return chart.properties(height=height) if height else chart
