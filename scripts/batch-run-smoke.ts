#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batchRun } from "../tools/batch.ts";

const batchDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-batch-smoke-"));

try {
  const result = await batchRun({
    batchDir,
    asks: ["Investigate primary-source maps and planning documents for a narrow province topic."],
  });
  assert.equal(result.runs.length, 1);
  assert.ok(result.runs[0]?.traceEvents);
  assert.ok(result.runs[0]?.runDir.startsWith("runs/"));
  const summary = JSON.parse(await readFile(result.summaryArtifact, "utf8"));
  assert.equal(summary.runs.length, 1);

  console.log(JSON.stringify({ ok: true, smoke: "batch-run", runs: result.runs.length }, null, 2));
} finally {
  await rm(batchDir, { recursive: true, force: true });
}
