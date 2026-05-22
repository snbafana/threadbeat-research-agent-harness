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
  "session.jsonl",
  "decision-log.md",
  "critic.md",
  "harness-patch.md",
  "task.json",
  "artifacts/source-1.json",
  "artifacts/index.json",
  "artifacts/source-map.json",
  "artifacts/search-results.json",
  "artifacts/source-decisions.json",
]) {
  assert.ok(existsSync(path.join(runDir, file)), `missing ${file}`);
}

const trace = readFileSync(path.join(runDir, "trace.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const sourceDecisions = JSON.parse(readFileSync(path.join(runDir, "artifacts/source-decisions.json"), "utf8"));
assert.ok(trace.some((event) => event.action === "task_loaded"));
assert.ok(trace.some((event) => event.action === "critic_note"));
assert.ok(trace.some((event) => event.action === "tool_started" && event.tool === "query.expand"));
assert.ok(trace.some((event) => event.action === "tool_started" && event.tool === "web.search"));
assert.ok(trace.some((event) => event.action === "tool_completed" && event.tool === "web.fetch"));
assert.ok(trace.some((event) => event.action === "tool_completed" && event.tool === "browser.snapshot"));
assert.ok(trace.some((event) => event.action === "tool_started" && event.tool === "pdf.extract") === false || trace.some((event) => event.action === "tool_completed" && event.tool === "pdf.extract"));
assert.ok(trace.some((event) => event.action === "tool_completed" && event.tool === "source.classify"));
assert.ok(trace.some((event) => event.action === "tool_completed" && event.tool === "source.rank"));
assert.ok(trace.some((event) => event.action === "tool_completed" && event.tool === "trace.critic"));
assert.ok(trace.some((event) => event.action === "save_point"));
assert.ok(trace.some((event) => event.action === "searched"));
assert.ok(trace.some((event) => event.action === "opened_url"));
assert.ok(trace.every((event) => event.reason), "every trace event needs a reviewable reason");
assert.ok(sourceDecisions.every((source: { textChars: number; decision: string }) => source.textChars > 0 || source.decision === "rejected"), "empty extracted pages must not be saved");
const session = readFileSync(path.join(runDir, "session.jsonl"), "utf8");
assert.match(session, /"kind":"task"/);
assert.match(session, /"kind":"tool_call"/);
assert.match(session, /"kind":"save_point"/);

console.log(JSON.stringify({
  ok: true,
  runDir: runDirMatch[0],
  traceEvents: trace.length,
}, null, 2));
