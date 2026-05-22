#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createToolRunner } from "./tools/research-tools.mjs";

const taskPath = process.argv[2] ?? ".threadbeat/task.json";
const task = JSON.parse(await readFile(taskPath, "utf8"));
const manifest = JSON.parse(await readFile("agent.json", "utf8"));
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
const runTool = createToolRunner({
  enabledTools: manifest.enabledTools,
  event,
});

event("task_loaded", {
  input: { ask: task.ask, agent: manifest.id, inputs: Object.keys(task.inputs ?? {}) },
  reason: "Start from the Threadbeat task payload and agent manifest so the run is reproducible.",
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

const searchResults = await runSearches(queryPlan.slice(0, 2));
await writeJson(path.join(runDir, "artifacts", "search-results.json"), searchResults);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "search-results.json"),
  reason: "Persist raw search result metadata so reviewers can inspect source selection.",
});

const sourceDecisions = await inspectSearchResults(searchResults.slice(0, 4));
await writeJson(path.join(runDir, "artifacts", "source-decisions.json"), sourceDecisions);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "source-decisions.json"),
  reason: "Save source save/reject decisions separately from the narrative report.",
});

const sourceMap = {
  task: task.ask,
  sources: sourceDecisions.filter((source) => source.decision === "saved"),
  rejected: sourceDecisions.filter((source) => source.decision === "rejected"),
  next_leads: queryPlan.slice(1),
};
await writeJson(path.join(runDir, "artifacts", "source-map.json"), sourceMap);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "source-map.json"),
  reason: "Save the source map even in the stub run so reviewers can inspect the schema.",
});

const decisionLog = `# Decision Log

Task: ${task.ask}

- Started with a manifest-declared tool harness instead of hidden web calls.
- Planned query expansion before extraction because search language is a likely failure mode.
- Ran web.search over the initial query plan.
- Opened a bounded number of result URLs with web.fetch.
- Classified sources with source.classify and saved or rejected them with explicit reasons.
`;
await writeFile(path.join(runDir, "decision-log.md"), decisionLog);
event("artifact_created", {
  artifact: path.join(runDir, "decision-log.md"),
  reason: "Expose explicit rationale without depending on hidden model thoughts.",
});

const critic = `# Critic Report

Failure labels:

- bad_query_language
- ${sourceDecisions.some((source) => source.decision === "saved") ? "stopped_too_early" : "missed_primary_source"}

Assessment:

This run uses search/fetch tools but still lacks browser screenshots, PDF
handling, translation, and a model critic over the trace.

Next harness change:

Add browser/PDF/translation tools and replace the static critic with a model
critic that reads trace.jsonl plus source-decisions.json.
`;
await writeFile(path.join(runDir, "critic.md"), critic);
event("critic_note", {
  output: ["bad_query_language", "no_clear_next_lead"],
  artifact: path.join(runDir, "critic.md"),
  reason: "The critic names the first harness limitation before the next run.",
});

const patch = `# Harness Patch Proposal

Change one thing next:

Add a browser/PDF/translation provider step that must emit:

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

async function runSearches(queries) {
  const all = [];
  for (const query of queries) {
    const results = await runTool("web.search", { query, limit: 5 }, "Search is an explicit tool call so the trace shows what query produced each lead.");
    event("searched", {
      input: query,
      output: results.map(({ title, url }) => ({ title, url })),
      reason: "Persist the result list before choosing sources to open.",
    });
    all.push(...results.map((result) => ({ ...result, query })));
  }
  return dedupeByUrl(all);
}

async function inspectSearchResults(results) {
  const decisions = [];
  for (const result of results) {
    try {
      event("opened_url", {
        url: result.url,
        input: { title: result.title, query: result.query },
        reason: "Open promising search results before deciding whether to save or reject them.",
      });
      const fetched = await runTool("web.fetch", { url: result.url, maxChars: 8000 }, "Fetch source text through the tool runner so artifacts and failures can be audited.");
      const decision = await runTool("source.classify", { result, fetched }, "Classify source quality separately from fetching so source taste can be tuned.");
      const artifact = path.join(runDir, "artifacts", `source-${decisions.length + 1}.json`);
      await writeJson(artifact, { result, fetched, decision });
      event(decision.decision === "saved" ? "source_saved" : "source_rejected", {
        url: result.url,
        output: decision,
        artifact,
        reason: decision.reason,
        failure: decision.failure,
      });
      decisions.push({ ...result, ...decision, artifact });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = {
        decision: "rejected",
        reason: `Could not fetch source: ${message}`,
        failure: "failed_to_save_artifact",
      };
      event("source_rejected", {
        url: result.url,
        output: decision,
        reason: decision.reason,
        failure: decision.failure,
      });
      decisions.push({ ...result, ...decision });
    }
  }
  return decisions;
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}
