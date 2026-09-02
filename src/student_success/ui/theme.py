CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,600;9..144,720&family=Manrope:wght@400;500;600;700&display=swap');
:root { --ink:#102a2d; --paper:#f3efe6; --card:#fffdf7; --coral:#ee5b3e; --mint:#9dd8c8; --teal:#0f8b8d; --sun:#f2cb62; --line:#c9c4b8; --muted:#60716d; }
.stApp { background:var(--paper); color:var(--ink); font-family:'Manrope',sans-serif; }
.stApp::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.24; background-image:radial-gradient(#7d8c87 .7px,transparent .7px); background-size:18px 18px; }
[data-testid="stSidebar"] { background:#102a2d; color:#f8f2e7; border-right:0; }
[data-testid="stSidebar"] * { color:#f8f2e7; }
[data-testid="stSidebar"] [data-baseweb="select"] > div { background:#173b3e; border-color:#486163; }
[data-testid="stSidebar"] [role="radiogroup"] label { padding:.35rem .55rem; border-left:3px solid transparent; }
[data-testid="stSidebar"] [role="radiogroup"] label:has(input:checked) { background:#173b3e; border-left-color:var(--coral); }
h1,h2,h3,h4 { font-family:'Fraunces',serif !important; color:var(--ink) !important; letter-spacing:-.025em; }
h1 { font-size:3.35rem !important; line-height:.98 !important; margin-bottom:.2rem !important; }
.eyebrow { font:500 .7rem 'DM Mono',monospace; text-transform:uppercase; letter-spacing:.14em; color:#536965; margin-bottom:.8rem; }
.hero-rule { width:82px; height:7px; background:var(--coral); margin:1rem 0 1.4rem; }
.lede { max-width:840px; font-size:1.02rem; line-height:1.65; color:#39504f; }
.metric-card { background:var(--card); border:1px solid var(--line); padding:17px 19px; min-height:108px; box-shadow:6px 6px 0 #d9d2c5; }
.metric-card .label { font:500 .66rem 'DM Mono',monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.metric-card .value { font:600 2.15rem 'Fraunces',serif; line-height:1.1; margin-top:7px; }
.metric-card .sub { color:#697975; font-size:.72rem; margin-top:5px; }
.surface-card { background:var(--card); border:1px solid var(--line); border-top:7px solid var(--mint); padding:18px; min-height:205px; box-shadow:4px 4px 0 #d8d1c5; }
.surface-card.coral { border-top-color:var(--coral); }
.surface-card.sun { border-top-color:var(--sun); }
.surface-card.teal { border-top-color:var(--teal); }
.surface-card .kicker { font:500 .66rem 'DM Mono'; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
.surface-card .title { font:600 1.35rem 'Fraunces'; margin:.65rem 0; }
.surface-card .copy { color:#526662; line-height:1.55; font-size:.88rem; }
.pipeline { display:flex; gap:8px; align-items:stretch; margin:1.1rem 0 1.8rem; overflow-x:auto; padding:5px 4px 11px; }
.node { min-width:145px; background:var(--card); border:1px solid var(--line); padding:14px; box-shadow:3px 3px 0 #d8d1c5; }
.node.agent { border-top:5px solid var(--teal); }
.node.human { border-top:5px solid var(--coral); }
.node .n { font:500 .61rem 'DM Mono'; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; }
.node .t { font-weight:700; margin-top:5px; line-height:1.25; }
.arrow { align-self:center; color:#6b7e7a; font-size:1.3rem; }
.status-pill { display:inline-block; border:1px solid currentColor; padding:3px 8px; border-radius:999px; font:500 .66rem 'DM Mono'; }
.source-card { background:var(--card); border-top:7px solid var(--mint); padding:18px; min-height:210px; box-shadow:4px 4px 0 #d8d1c5; }
.source-card.bad { border-top-color:var(--coral); }
.source-card.na { border-top-color:var(--sun); }
.source-name { font:500 .7rem 'DM Mono'; text-transform:uppercase; letter-spacing:.12em; }
.bar-row { display:grid; grid-template-columns:120px 1fr 36px; gap:12px; align-items:center; margin:.7rem 0; font-size:.82rem; }
.bar-track { background:#ded9cf; height:12px; }
.bar-fill { height:12px; background:var(--teal); }
.bar-fill.coral { background:var(--coral); }
.timeline { border-left:2px solid #99aaa5; padding-left:22px; margin-left:10px; }
.event { position:relative; background:var(--card); border:1px solid var(--line); padding:13px 15px; margin:0 0 12px; }
.event:before { content:""; position:absolute; width:12px; height:12px; border-radius:50%; background:var(--coral); left:-29px; top:18px; box-shadow:0 0 0 5px var(--paper); }
.event .seq { font:500 .66rem 'DM Mono'; color:#6a7774; }
.event .type { font-weight:700; margin:.2rem 0; }
.event .meta { color:#61716e; font-size:.76rem; }
.callout { background:#102a2d; color:#f7f1e5; padding:17px 19px; border-left:7px solid var(--coral); line-height:1.55; }
.callout b { color:var(--sun); }
.soft-callout { background:#e2eee9; border-left:6px solid var(--teal); padding:15px 17px; color:#294846; }
.role-ribbon { display:inline-block; background:#102a2d; color:#fff; padding:6px 10px; font:500 .66rem 'DM Mono'; letter-spacing:.08em; text-transform:uppercase; }
code { font-family:'DM Mono',monospace !important; }
[data-testid="stDataFrame"] { border:1px solid var(--line); }
.stTabs [data-baseweb="tab-list"] { gap:0; border-bottom:1px solid var(--line); }
.stTabs [data-baseweb="tab"] { font-family:'DM Mono',monospace; letter-spacing:.04em; border-radius:0; padding:12px 18px; }
.stTabs [aria-selected="true"] { background:#102a2d !important; color:white !important; }
.stButton button, .stDownloadButton button { border-radius:0; border:1px solid var(--ink); font-family:'Manrope'; font-weight:700; box-shadow:3px 3px 0 #a8a399; }
.stButton button:hover, .stDownloadButton button:hover { border-color:var(--coral); color:var(--coral); transform:translate(-1px,-1px); box-shadow:5px 5px 0 #a8a399; }
footer,#MainMenu { visibility:hidden; }
[data-testid="stAppDeployButton"] { display:none !important; }
header[data-testid="stHeader"] { background:var(--paper); }
@media (max-width:900px) { h1{font-size:2.5rem!important}.pipeline{display:block}.arrow{padding:.3rem 0}.node{margin-bottom:.4rem}.bar-row{grid-template-columns:90px 1fr 30px} }
</style>
"""
