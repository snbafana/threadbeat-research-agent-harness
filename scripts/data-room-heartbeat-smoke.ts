#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataRoomDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-data-room-"));

try {
  for (let index = 0; index < 2; index += 1) {
    execFileSync("npx", ["tsx", "scripts/data-room-heartbeat.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_ROOM_DIR: dataRoomDir,
        DATA_ROOM_QUERY: "site:en.wikipedia.org AI safety researcher",
      },
    });
  }

  const state = JSON.parse(await readFile(path.join(dataRoomDir, "people.json"), "utf8"));
  const trace = await readFile(path.join(dataRoomDir, "tool-trace.jsonl"), "utf8");
  assert.equal(state.people.length, 2);
  assert.notEqual(state.people[0]?.sourceUrl, state.people[1]?.sourceUrl);
  assert.match(trace, /"tool":"web.search"/);

  console.log(JSON.stringify({ ok: true, smoke: "data-room-heartbeat", people: state.people.length }, null, 2));
} finally {
  await rm(dataRoomDir, { recursive: true, force: true });
}
