#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const taskPath = process.argv[2] ?? ".threadbeat/task.json";
const task = JSON.parse(await readFile(taskPath, "utf8"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join("runs", runId);

await mkdir(path.join(runDir, "artifacts"), { recursive: true });

const trace = [];
function event(action, data) {
  trace.push({
    time: new Date().toISOString(),
    action,
    ...data,
  });
}

event("task_loaded", {
  input: { ask: task.ask, inputs: Object.keys(task.inputs ?? {}) },
  reason: "Start from the Threadbeat task payload so the run is reproducible.",
});

const queryPlan = [
  task.ask,
  `${task.ask} primary sources`,
  `${task.ask} maps planning documents local language terms`,
];
event("query_planned", {
  input: task.ask,
  output: queryPlan,
  reason: "Baseline query expansion before any browser/device provider is added.",
  failure: "bad_query_language",
});

const sourceMap = {
  task: task.ask,
  sources: [],
  rejected: [
    {
      title: "Generic summary pages",
      reason: "Likely too shallow unless they unlock primary documents or local-language terms.",
    },
  ],
  next_leads: queryPlan.slice(1),
};
await writeJson(path.join(runDir, "artifacts", "source-map.json"), sourceMap);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "source-map.json"),
  reason: "Save the source map even in the stub run so reviewers can inspect the schema.",
});

const decisionLog = `# Decision Log

Task: ${task.ask}

- Started with a trace-first harness instead of a browser provider.
- Planned query expansion before extraction because search language is a likely failure mode.
- Marked generic summary pages as rejected unless they produce primary-source leads.
- No external browsing was performed in this starter run.
`;
await writeFile(path.join(runDir, "decision-log.md"), decisionLog);
event("artifact_created", {
  artifact: path.join(runDir, "decision-log.md"),
  reason: "Expose explicit rationale without depending on hidden model thoughts.",
});

const critic = `# Critic Report

Failure labels:

- bad_query_language
- no_clear_next_lead

Assessment:

This starter run proves the artifact shape but cannot judge real depth because no
browser/device path has been connected yet.

Next harness change:

Add one environment provider smoke that performs real browsing, captures URLs and
screenshots, and writes source save/reject events into this trace format.
`;
await writeFile(path.join(runDir, "critic.md"), critic);
event("critic_note", {
  output: ["bad_query_language", "no_clear_next_lead"],
  artifact: path.join(runDir, "critic.md"),
  reason: "The critic names the first harness limitation before the next run.",
});

const patch = `# Harness Patch Proposal

Change one thing next:

Add a real browser/device provider step that must emit:

- searched query
- opened URL
- screenshot or DOM/text snapshot path
- save/reject decision
- follow-up lead

Keep the provider implementation inside this agent repo until two runs prove the
same code needs to move into Threadbeat core.
`;
await writeFile(path.join(runDir, "harness-patch.md"), patch);
event("harness_patch_proposed", {
  artifact: path.join(runDir, "harness-patch.md"),
  reason: "Make the next implementation step concrete and reviewable.",
});

event("run_completed", {
  output: { runDir },
  reason: "Starter run finished with trace, decision log, critic report, and patch proposal.",
});

await writeFile(path.join(runDir, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
await writeJson(path.join(runDir, "task.json"), task);

console.log("research-agent-starter-ok");
console.log(runDir);

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
