"""Offline check of the engine process pool in bridge.py (no database, no model).

A stand-in engine speaks the same line protocol as the real one (one JSON request per
line, one JSON answer per line, one request at a time per process). It reports its
process id, so the check can see which process served which request:

  * model-calling actions run in their own process; a slow plan never blocks reads,
  * one person's sequential reads stay on the same (warm) reader process,
  * two requests at the same moment are served by two readers, in parallel,
  * agent actions share one process (one model rate limiter),
  * the warm-up reaches both readers and does not start the agent process,
  * an error from the engine keeps its code and leaves the pool usable.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import os

os.environ.setdefault("AURA_DISABLE_WARMUP", "1")
from bridge import AGENT_ACTIONS, BridgeError, Client  # noqa: E402

FAKE_ENGINE = r"""
import { createInterface } from "node:readline";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for await (const line of createInterface({ input: process.stdin })) {
  const req = JSON.parse(line);
  const ms = Number(req.payload?.ms ?? 0);
  if (ms) await sleep(ms);
  if (req.action === "boom")
    process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: { code: "NOPE", message: "refused", status: 403 } }) + "\n");
  else
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, data: { pid: process.pid, action: req.action } }) + "\n");
}
"""

node = shutil.which("node")
if not node:
    sys.exit("node is required for this check")
work = Path(tempfile.mkdtemp(prefix="aura-pool-"))
script = work / "fake-engine.mjs"
script.write_text(FAKE_ENGINE)
client = Client(script, env=dict(os.environ), node=node)
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


try:
    check("the model-calling actions are the planner, the agent run and the replay",
          AGENT_ACTIONS == {"plan_save", "plan_revise", "plan_execute", "replay"}, str(sorted(AGENT_ACTIONS)))

    # 1. a slow plan does not block reads
    plan: dict = {}
    thread = threading.Thread(target=lambda: plan.update(client.request("plan_execute", {"ms": 1500})))
    thread.start()
    time.sleep(0.3)
    start = time.perf_counter()
    read = client.request("overview")
    took = time.perf_counter() - start
    thread.join()
    check("a read is answered while a plan runs", took < 0.9, f"{took:.2f}s")
    check("the read is served by a different process than the plan", read["pid"] != plan["pid"])

    # 2. a lone user stays on one reader
    pids = {client.request("overview")["pid"] for _ in range(5)}
    check("sequential reads stay on one reader", len(pids) == 1, str(pids))

    # 3. two simultaneous reads use two readers in parallel
    results: list[dict] = []
    gate = threading.Barrier(2)

    def slow_read() -> None:
        gate.wait()
        results.append(client.request("student", {"ms": 800}))

    threads = [threading.Thread(target=slow_read) for _ in range(2)]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    took = time.perf_counter() - start
    check("two simultaneous reads run in parallel", took < 1.4, f"{took:.2f}s")
    check("they were served by two different readers", len({r["pid"] for r in results}) == 2)

    # 4. agent actions share one process
    agent_pids = {client.request(a)["pid"] for a in ("plan_save", "plan_revise", "plan_execute", "replay")}
    check("agent actions share one process", len(agent_pids) == 1, str(agent_pids))

    # 5. an error keeps its code, and the pool still works afterwards
    try:
        client.request("boom")
        check("an engine error is raised", False)
    except BridgeError as error:
        check("an engine error keeps its code and status", error.code == "NOPE" and error.status == 403)
    check("the pool still answers after an error", client.request("overview")["action"] == "overview")
    check("no request is left counted as pending", all(w.pending == 0 for w in client.workers()))
finally:
    client.close()
    shutil.rmtree(work, ignore_errors=True)

# 6. warm-up reaches both readers and leaves the agent process alone
work = Path(tempfile.mkdtemp(prefix="aura-pool-"))
script = work / "fake-engine.mjs"
script.write_text(FAKE_ENGINE)
client = Client(script, env=dict(os.environ), node=node)
try:
    client.warm()
    readers = client.workers()[:-1]
    check("warm-up starts both readers", all(w.started for w in readers))
    check("warm-up leaves the agent process unstarted", not client.workers()[-1].started)
finally:
    client.close()
    shutil.rmtree(work, ignore_errors=True)

if failures:
    sys.exit(f"{len(failures)} check(s) failed: {failures}")
print("bridge pool checks passed")
