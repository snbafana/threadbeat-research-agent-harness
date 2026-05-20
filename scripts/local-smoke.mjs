#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const taskDir = path.join(root, ".threadbeat");
mkdirSync(taskDir, { recursive: true });
writeFileSync(path.join(taskDir, "task.json"), JSON.stringify({
  ask: "Investigate primary-source maps and planning documents for a narrow province topic.",
  inputs: {
    files: [
      {
        path: ".threadbeat/seed.txt",
        content: "starter seed",
      },
    ],
  },
}, null, 2));

const output = execFileSync("node", ["threadbeat-agent.mjs", ".threadbeat/task.json"], {
  cwd: root,
  encoding: "utf8",
});
assert.match(output, /research-agent-starter-ok/);

const runDirMatch = output.match(/runs\/[^\s]+/);
assert.ok(runDirMatch, output);
const runDir = path.join(root, runDirMatch[0]);

for (const file of [
  "trace.jsonl",
  "decision-log.md",
  "critic.md",
  "harness-patch.md",
  "task.json",
  "artifacts/source-map.json",
]) {
  assert.ok(existsSync(path.join(runDir, file)), `missing ${file}`);
}

const trace = readFileSync(path.join(runDir, "trace.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert.ok(trace.some((event) => event.action === "task_loaded"));
assert.ok(trace.some((event) => event.action === "critic_note"));
assert.ok(trace.every((event) => event.reason), "every trace event needs a reviewable reason");

console.log(JSON.stringify({
  ok: true,
  runDir: runDirMatch[0],
  traceEvents: trace.length,
}, null, 2));
