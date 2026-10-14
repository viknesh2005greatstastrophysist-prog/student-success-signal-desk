import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  collectSnapshot,
  closePool,
  readerTimeoutMs,
  rollbackQuietly,
  withCoreTransaction,
} from "../lib/db";
import {
  persistThenAudit,
  startLeaseHeartbeat,
} from "../lib/chapter11/lease";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A scripted stand-in for a pooled pg client; every statement is logged. */
function fakeClient(
  log: string[],
  tag: string,
  options: { failOn?: RegExp; rollbackFails?: boolean } = {},
) {
  const released: unknown[] = [];
  return {
    released,
    async query(sql: string) {
      const text = sql.replace(/\s+/g, " ").trim();
      log.push(`${tag}: ${text}`);
      if (/^ROLLBACK/.test(text) && options.rollbackFails)
        throw new Error("rollback failed");
      if (options.failOn?.test(text)) throw new Error("injected failure");
      if (/pg_export_snapshot/.test(text))
        return { rows: [{ snapshot: "00000003-0000001B-1" }], rowCount: 1 };
      if (/FROM institution_revisions/.test(text))
        return { rows: [{ revision: "7" }], rowCount: 1 };
      if (/pg_advisory_unlock_shared/.test(text))
        return { rows: [{ ok: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release(error?: unknown) {
      released.push(error);
    },
  };
}

/** Run `body` with Pool.connect handing out the given clients in order and a
 * dummy connection string; nothing here ever opens a socket. */
async function withFakePool(
  clients: Array<ReturnType<typeof fakeClient>>,
  body: () => Promise<void>,
) {
  const proto = pg.Pool.prototype as unknown as { connect: unknown };
  const originalConnect = proto.connect;
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    CORE_DATABASE_SCHEMA: process.env.CORE_DATABASE_SCHEMA,
    CORE_IDENTITY_REALM: process.env.CORE_IDENTITY_REALM,
    CH11_READER_TIMEOUT_MS: process.env.CH11_READER_TIMEOUT_MS,
  };
  let next = 0;
  proto.connect = async () => clients[next++] ?? clients[clients.length - 1];
  process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
  delete process.env.DATABASE_URL_UNPOOLED;
  process.env.CORE_DATABASE_SCHEMA = "aura_core_test_ch11_stub";
  delete process.env.CORE_IDENTITY_REALM;
  try {
    await body();
  } finally {
    proto.connect = originalConnect;
    await closePool();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("B3 lease heartbeat renews on an interval, stops on request and when the lease is lost", async () => {
  let renewals = 0;
  const beat = startLeaseHeartbeat(async () => {
    renewals++;
    return true;
  }, 10);
  await sleep(70);
  beat.stop();
  const atStop = renewals;
  assert.ok(atStop >= 2, `expected repeated renewals, saw ${atStop}`);
  await sleep(50);
  assert.equal(renewals, atStop, "no renewal after stop()");

  let lostCalls = 0;
  startLeaseHeartbeat(async () => {
    lostCalls++;
    return false;
  }, 10);
  await sleep(80);
  assert.equal(lostCalls, 1, "stops itself once the lease is lost");

  const errors: unknown[] = [];
  let attempts = 0;
  const flaky = startLeaseHeartbeat(
    async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return true;
    },
    10,
    (error) => errors.push(error),
  );
  await sleep(80);
  flaky.stop();
  assert.equal(errors.length, 1, "a renewal error is reported, not thrown");
  assert.ok(attempts >= 2, "renewal is retried after an error");

  let active = 0;
  let overlapped = false;
  const slow = startLeaseHeartbeat(async () => {
    active++;
    if (active > 1) overlapped = true;
    await sleep(35);
    active--;
    return true;
  }, 10);
  await sleep(120);
  slow.stop();
  assert.equal(overlapped, false, "a slow renewal is never overlapped");
});

test("B2 the status change is persisted even when the audit write fails", async () => {
  const order: string[] = [];
  const logged: unknown[] = [];
  const applied = await persistThenAudit(
    async () => {
      order.push("persist");
      return true;
    },
    async () => {
      order.push("audit");
      throw new Error("audit pool error");
    },
    (error) => logged.push(error),
  );
  assert.equal(applied, true);
  assert.deepEqual(order, ["persist", "audit"]);
  assert.equal(logged.length, 1);

  let audited = false;
  assert.equal(
    await persistThenAudit(
      async () => false,
      async () => {
        audited = true;
      },
    ),
    false,
  );
  assert.equal(audited, false, "no audit row when no row was updated");

  await assert.rejects(
    () =>
      persistThenAudit(
        async () => {
          throw new Error("update failed");
        },
        async () => {
          audited = true;
        },
      ),
    /update failed/,
  );
  assert.equal(audited, false);
});

test("B7 a failing ROLLBACK is returned, never thrown over the original error", async () => {
  const log: string[] = [];
  assert.equal(await rollbackQuietly(fakeClient(log, "ok")), undefined);
  const failed = await rollbackQuietly(
    fakeClient(log, "bad", { rollbackFails: true }),
  );
  assert.match(failed?.message ?? "", /rollback failed/);

  const client = fakeClient(log, "tx", { rollbackFails: true });
  await withFakePool([client], async () => {
    await assert.rejects(
      () =>
        withCoreTransaction(async () => {
          throw new Error("original failure");
        }),
      /original failure/,
    );
  });
  assert.equal(client.released.length, 1);
  assert.match(
    (client.released[0] as Error).message,
    /rollback failed/,
    "client is released with the error flag so the pool discards it",
  );

  const clean = fakeClient(log, "clean");
  await withFakePool([clean], async () => {
    await assert.rejects(
      () =>
        withCoreTransaction(async () => {
          throw new Error("original failure");
        }),
      /original failure/,
    );
  });
  assert.deepEqual(clean.released, [undefined], "healthy client is reused");
});

test("B5/B6/B7 snapshot capture locks before BEGIN, times out readers and discards bad connections", async () => {
  const log: string[] = [];
  const exporter = fakeClient(log, "exporter");
  const reader = fakeClient(log, "reader");
  await withFakePool([exporter, reader], async () => {
    const out = await collectSnapshot([async () => "a", async () => "b"], 1);
    assert.deepEqual(out.results, ["a", "b"]);
    assert.equal(out.evidenceRevision, "7");
  });
  const exporterLog = log
    .filter((line) => line.startsWith("exporter:"))
    .map((line) => line.slice("exporter: ".length));
  const lock = exporterLog.findIndex((q) => /pg_advisory_lock_shared/.test(q));
  const begin = exporterLog.findIndex((q) => /^BEGIN ISOLATION LEVEL REPEATABLE READ/.test(q));
  assert.ok(lock >= 0 && begin > lock, "shared lock is taken before the snapshot transaction begins");
  assert.ok(
    !exporterLog.some((q) => /pg_advisory_xact_lock_shared/.test(q)),
    "no transaction-scoped lock is requested inside the snapshot",
  );
  assert.ok(
    exporterLog.some((q) => /^SET LOCAL statement_timeout = 20000$/.test(q)),
    "exporter has a statement timeout",
  );
  const commit = exporterLog.indexOf("COMMIT");
  const unlock = exporterLog.findIndex((q) => /pg_advisory_unlock_shared/.test(q));
  assert.ok(commit >= 0 && unlock > commit, "lock is released after the commit");
  assert.deepEqual(exporter.released, [undefined]);
  const readerLog = log
    .filter((line) => line.startsWith("reader:"))
    .map((line) => line.slice("reader: ".length));
  assert.ok(
    readerLog.some((q) => /^SET LOCAL statement_timeout = 20000$/.test(q)),
    "each reader has a statement timeout",
  );
  assert.equal(readerLog.filter((q) => /^COMMIT$/.test(q)).length, 2);

  // A reader failure with a throwing ROLLBACK surfaces the original error and
  // discards both connections.
  const failLog: string[] = [];
  const badExporter = fakeClient(failLog, "exporter");
  const badReader = fakeClient(failLog, "reader", { rollbackFails: true });
  await withFakePool([badExporter, badReader], async () => {
    await assert.rejects(
      () =>
        collectSnapshot([
          async () => {
            throw new Error("source read failed");
          },
        ]),
      /source read failed/,
    );
  });
  assert.match((badReader.released[0] as Error).message, /rollback failed/);
  assert.deepEqual(badExporter.released, [undefined]);
  assert.ok(
    failLog.some((l) => /exporter: .*pg_advisory_unlock_shared/.test(l)),
    "lock is released even when capture fails",
  );
});

test("B6 reader timeout is configurable and rejects unusable values", () => {
  assert.equal(readerTimeoutMs({}), 20000);
  assert.equal(readerTimeoutMs({ CH11_READER_TIMEOUT_MS: "5000" }), 5000);
  for (const bad of ["0", "-1", "abc", "1.5", "99999999", ""])
    assert.equal(readerTimeoutMs({ CH11_READER_TIMEOUT_MS: bad }), 20000);
});
