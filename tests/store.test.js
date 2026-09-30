import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HoleCountStore, RevisionConflictError } from "../server/store.js";

let dataDir;
let store;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "guitar-hole-count-store-"));
  store = new HoleCountStore({ dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("a morning count replaces the snapshot and resets breakout progress", async () => {
  await store.setMorningCount([
    { label: "Fender", count: 17 },
    { label: "Gibson", count: 9 },
    { label: "Ibanez", count: 12 },
  ]);
  await store.breakOut([{ label: "Fender", quantity: 6 }]);
  await store.setMorningCount([
    { label: "Fender", count: 4 },
    { label: "Gretsch", count: 2 },
  ]);

  const snapshot = await store.snapshot();
  assert.deepEqual(snapshot.rows, [
    { label: "Fender", starting: 4, remaining: 4, brokenOut: 0 },
    { label: "Gretsch", starting: 2, remaining: 2, brokenOut: 0 },
  ]);
  assert.deepEqual(snapshot.totals, { starting: 6, remaining: 6, brokenOut: 0 });
});

test("configured wall bookends are permanent without resetting current progress", async () => {
  await store.setMorningCount([
    { label: "Fender", count: 5 },
    { label: "Ibanez", count: 4 },
  ]);
  await store.breakOut([{ label: "Fender", quantity: 2 }]);
  const priorRevision = (await store.snapshot()).revision;

  const orderedStore = new HoleCountStore({
    dataDir,
    bookends: { first: "Boutique", last: "Misc. Acoustic" },
  });
  await orderedStore.ensureBookends();
  let snapshot = await orderedStore.snapshot();
  assert.deepEqual(snapshot.rows, [
    { label: "Boutique", starting: 0, remaining: 0, brokenOut: 0 },
    { label: "Fender", starting: 5, remaining: 3, brokenOut: 2 },
    { label: "Ibanez", starting: 4, remaining: 4, brokenOut: 0 },
    { label: "Misc. Acoustic", starting: 0, remaining: 0, brokenOut: 0 },
  ]);
  assert.equal(snapshot.revision, priorRevision + 1);

  await orderedStore.ensureBookends();
  assert.equal((await orderedStore.snapshot()).revision, snapshot.revision);

  await orderedStore.setMorningCount([{ label: "Gibson", count: 7 }]);
  snapshot = await orderedStore.snapshot();
  assert.deepEqual(snapshot.rows, [
    { label: "Boutique", starting: 0, remaining: 0, brokenOut: 0 },
    { label: "Gibson", starting: 7, remaining: 7, brokenOut: 0 },
    { label: "Misc. Acoustic", starting: 0, remaining: 0, brokenOut: 0 },
  ]);
});

test("one breakout call updates multiple categories atomically", async () => {
  await store.setMorningCount([
    { label: "Fender", count: 17 },
    { label: "Ibanez", count: 12 },
  ]);
  await store.breakOut([
    { label: "fender", quantity: 3 },
    { label: "Ibanez", quantity: 2 },
  ]);

  const snapshot = await store.snapshot();
  assert.equal(snapshot.rows[0].remaining, 14);
  assert.equal(snapshot.rows[1].remaining, 10);
  assert.equal(snapshot.totals.remaining, 24);
  assert.equal(snapshot.totals.brokenOut, 5);
});

test("a failing breakout batch changes no category and never goes below zero", async () => {
  await store.setMorningCount([
    { label: "Fender", count: 2 },
    { label: "Ibanez", count: 1 },
  ]);

  await assert.rejects(
    () =>
      store.breakOut([
        { label: "Fender", quantity: 1 },
        { label: "Ibanez", quantity: 2 },
      ]),
    /only has 1 hole remaining/
  );

  assert.deepEqual((await store.snapshot()).totals, {
    starting: 3,
    remaining: 3,
    brokenOut: 0,
  });
});

test("corrections put holes back but cannot exceed the morning count", async () => {
  await store.setMorningCount([{ label: "Fender", count: 2 }]);
  await store.breakOut([{ label: "Fender", quantity: 1 }]);
  await store.adjustBalance([{ label: "fender", delta: 1 }]);
  assert.equal((await store.snapshot()).rows[0].remaining, 2);
  await assert.rejects(
    () => store.adjustBalance([{ label: "Fender", delta: 1 }]),
    /between 0 and its morning count/
  );
});

test("editing an observed count preserves legitimate breakout progress", async () => {
  await store.setMorningCount([{ label: "Fender", count: 17 }]);
  await store.breakOut([{ label: "Fender", quantity: 6 }]);

  await store.correctCount([{ label: "fender", remaining: 12 }]);
  let snapshot = await store.snapshot();
  assert.deepEqual(snapshot.rows[0], {
    label: "Fender",
    starting: 18,
    remaining: 12,
    brokenOut: 6,
  });

  const revision = snapshot.revision;
  await store.correctCount([{ label: "Fender", remaining: 12 }]);
  snapshot = await store.snapshot();
  assert.equal(snapshot.revision, revision);
  assert.equal(snapshot.totals.brokenOut, 6);
});

test("multiple observed-count corrections are atomic", async () => {
  await store.setMorningCount([
    { label: "Fender", count: 5 },
    { label: "Ibanez", count: 4 },
  ]);
  await store.breakOut([
    { label: "Fender", quantity: 2 },
    { label: "Ibanez", quantity: 1 },
  ]);

  await assert.rejects(
    () =>
      store.correctCount([
        { label: "Fender", remaining: 4 },
        { label: "Unknown", remaining: 2 },
      ]),
    /No current row/
  );
  assert.deepEqual((await store.snapshot()).totals, {
    starting: 9,
    remaining: 6,
    brokenOut: 3,
  });
});

test("the current snapshot survives a fresh store instance", async () => {
  await store.setMorningCount([{ label: "Fender", count: 5 }]);
  await store.breakOut([{ label: "Fender", quantity: 2 }]);

  const restartedStore = new HoleCountStore({ dataDir });
  const snapshot = await restartedStore.snapshot();
  assert.equal(snapshot.rows[0].remaining, 3);

  const persisted = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  assert.deepEqual(persisted.counts.Fender, { starting: 5, remaining: 3 });
});

test("the redundant snapshot survives a corrupt primary state file", async () => {
  await store.setMorningCount([{ label: "Fender", count: 5 }]);
  await store.breakOut([{ label: "Fender", quantity: 2 }]);
  await writeFile(path.join(dataDir, "state.json"), "not-json", "utf8");

  const restartedStore = new HoleCountStore({ dataDir });
  const snapshot = await restartedStore.snapshot();
  assert.equal(snapshot.rows[0].remaining, 3);

  const backup = JSON.parse(
    await readFile(path.join(dataDir, "state.backup.json"), "utf8")
  );
  assert.deepEqual(backup.counts.Fender, { starting: 5, remaining: 3 });
});

test("duplicate labels are rejected case-insensitively", async () => {
  await assert.rejects(
    () =>
      store.setMorningCount([
        { label: "Fender", count: 1 },
        { label: " fender ", count: 2 },
      ]),
    /Duplicate label/
  );
});

test("an R1 write cannot overwrite a newer ChatGPT revision", async () => {
  await store.setMorningCount([{ label: "Fender", count: 5 }]);
  const staleRevision = (await store.snapshot()).revision;
  await store.breakOut([{ label: "Fender", quantity: 1 }]);

  await assert.rejects(
    () =>
      store.correctCount(
        [{ label: "Fender", remaining: 5 }],
        { expectedRevision: staleRevision }
      ),
    RevisionConflictError
  );
  assert.equal((await store.snapshot()).rows[0].remaining, 4);
});
