#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolRunner } from "../tools/research-tools.ts";

const runDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-resume-plan-"));

try {
  await mkdir(path.join(runDir, "artifacts"), { recursive: true });
  await writeFile(path.join(runDir, "task.json"), `${JSON.stringify({ ask: "resume smoke" })}\n`);
  await writeFile(path.join(runDir, "trace.jsonl"), [
    { time: new Date().toISOString(), action: "task_loaded", reason: "smoke" },
    { time: new Date().toISOString(), action: "run_completed", reason: "smoke" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(path.join(runDir, "session.jsonl"), [
    { seq: 1, time: new Date().toISOString(), kind: "task" },
    { seq: 2, time: new Date().toISOString(), kind: "save_point", name: "frontier_planned" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(path.join(runDir, "artifacts", "index.json"), `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    files: ["source-map.json", "source-decisions.json", "source-1.json"],
  }, null, 2)}\n`);

  const events: Array<Record<string, unknown>> = [];
  const runTool = createToolRunner({
    enabledTools: ["resume.plan"],
    event(action, data) {
      events.push({ action, ...data });
    },
  });
  const result = await runTool("resume.plan", {
    runDir,
    nextTool: "external.critic",
    heartbeatIntervalMinutes: 1,
  }, "Exercise restart plan generation from persisted run files.") as {
    artifact: string;
    resumePrompt: string;
    shouldResume: boolean;
    lastSavePoint: string;
  };

  assert.ok(events.some((event) => event.action === "tool_started" && event.tool === "resume.plan"));
  assert.ok(events.some((event) => event.action === "tool_completed" && event.tool === "resume.plan"));
  assert.match(result.resumePrompt, /external\.critic/);
  assert.equal(result.shouldResume, false);
  assert.equal(result.lastSavePoint, "frontier_planned");
  const artifact = JSON.parse(await readFile(result.artifact, "utf8"));
  assert.equal(artifact.nextTool, "external.critic");

  console.log(JSON.stringify({ ok: true, smoke: "resume-plan" }, null, 2));
} finally {
  await rm(runDir, { recursive: true, force: true });
}
