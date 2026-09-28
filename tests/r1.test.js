import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHttpServer } from "../server/http.js";
import { HoleCountStore } from "../server/store.js";
import {
  ApiError,
  HoleCountApi,
  clampCount,
  stepCarousel,
  zeroedMorningRows,
} from "../r1/core.js";

let dataDir;
let httpServer;
let baseUrl;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "guitar-hole-count-r1-"));
  httpServer = createHttpServer({
    store: new HoleCountStore({ dataDir }),
    r1ApiToken: "r1-test-token",
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => httpServer?.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test("carousel math clamps counts and morning rows start at zero", () => {
  assert.equal(stepCarousel(4, "up"), 5);
  assert.equal(stepCarousel(0, "down"), 0);
  assert.equal(clampCount(5000), 999);
  assert.deepEqual(
    zeroedMorningRows({ rows: [{ label: "Fender", remaining: 8 }] }),
    [{ label: "Fender", count: 0 }]
  );
});

test("the R1 client and REST API share the authoritative store", async () => {
  const api = new HoleCountApi({ baseUrl, token: "r1-test-token" });
  let snapshot = await api.setMorningCount(
    [
      { label: "Fender", count: 5 },
      { label: "Ibanez", count: 3 },
    ],
    0
  );
  assert.equal(snapshot.totals.remaining, 8);

  snapshot = await api.breakOut("Fender", snapshot.revision);
  assert.equal(snapshot.rows[0].remaining, 4);
  assert.equal(snapshot.totals.brokenOut, 1);

  snapshot = await api.correct("Ibanez", 4, snapshot.revision);
  assert.equal(snapshot.rows[1].remaining, 4);
  assert.equal(snapshot.rows[1].starting, 4);
});

test("the R1 API requires its private bearer credential", async () => {
  const response = await fetch(`${baseUrl}/api/v1/snapshot`);
  assert.equal(response.status, 401);

  const wrongApi = new HoleCountApi({ baseUrl, token: "wrong" });
  await assert.rejects(() => wrongApi.snapshot(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    return true;
  });
});

test("stale R1 mutations return the refreshed authoritative snapshot", async () => {
  const api = new HoleCountApi({ baseUrl, token: "r1-test-token" });
  const current = await api.snapshot();
  await api.breakOut("Fender", current.revision);

  await assert.rejects(() => api.correct("Fender", 5, current.revision), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.snapshot.rows[0].remaining, 3);
    return true;
  });
});

test("the server hosts the R1 creation and it wires the hardware events", async () => {
  const response = await fetch(`${baseUrl}/r1/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Guitar Hole Count/);

  const appJs = await readFile(new URL("../r1/app.js", import.meta.url), "utf8");
  assert.match(appJs, /addEventListener\("scrollUp"/);
  assert.match(appJs, /addEventListener\("scrollDown"/);
  assert.match(appJs, /addEventListener\("sideClick"/);
  assert.match(appJs, /creationStorage\.secure/);
  assert.match(appJs, /zeroedMorningRows/);
});
