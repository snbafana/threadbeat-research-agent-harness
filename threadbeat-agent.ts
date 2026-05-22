#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRunState } from "./harness/run-state.ts";
import { createToolRunner } from "./tools/research-tools.ts";
import type { SearchResult } from "./tools/web.ts";

interface TaskPayload {
  ask: string;
  inputs?: Record<string, unknown>;
}

type SourceDecisionRecord = SearchResult & {
  query: string;
  decision: "saved" | "rejected";
  reason: string;
  sourceType?: string;
  textChars?: number;
  failure?: string | null;
  rank?: Record<string, unknown>;
  artifact?: string;
};

const taskPath = process.argv[2] ?? ".threadbeat/task.json";
const task = JSON.parse(await readFile(taskPath, "utf8")) as TaskPayload;
const manifest = JSON.parse(await readFile("agent.json", "utf8")) as { id: string; enabledTools: string[] };
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join("runs", runId);
const runState = await createRunState({ runDir });
const { appendSession, event, savePoint, writeArtifactIndex, writeTrace } = runState;
const runTool = createToolRunner({
  enabledTools: manifest.enabledTools,
  appendSession,
  event,
});

event("task_loaded", {
  input: { ask: task.ask, agent: manifest.id, inputs: Object.keys(task.inputs ?? {}) },
  reason: "Start from the Threadbeat task payload and agent manifest so the run is reproducible.",
});
await appendSession("task", {
  input: { ask: task.ask, agent: manifest.id, inputs: Object.keys(task.inputs ?? {}) },
});

const queryPlan = await runTool("query.expand", { ask: task.ask }, "Expand the task into explicit search frontiers before touching the web.") as string[];
event("query_planned", {
  input: task.ask,
  output: queryPlan,
  reason: "Query expansion is a tool call so search frontier changes can be tested and tuned.",
  failure: "bad_query_language",
});
await appendSession("plan", { output: queryPlan, failure: "bad_query_language" });
await savePoint("task_loaded", { traceEvents: runState.trace.length });

const searchResults = await runSearches(queryPlan.slice(0, 2));
await writeJson(path.join(runDir, "artifacts", "search-results.json"), searchResults);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "search-results.json"),
  reason: "Persist raw search result metadata so reviewers can inspect source selection.",
});
await savePoint("search_completed", { searchResults: searchResults.length });

const sourceDecisions = await inspectSearchResults(searchResults.slice(0, 4));
await writeJson(path.join(runDir, "artifacts", "source-decisions.json"), sourceDecisions);
event("artifact_created", {
  artifact: path.join(runDir, "artifacts", "source-decisions.json"),
  reason: "Save source save/reject decisions separately from the narrative report.",
});
await appendSession("source_decisions", {
  saved: sourceDecisions.filter((source) => source.decision === "saved").length,
  rejected: sourceDecisions.filter((source) => source.decision === "rejected").length,
});
await savePoint("source_triage_completed", { sourceDecisions: sourceDecisions.length });

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
- Planned query expansion with query.expand because search language is a likely failure mode.
- Ran web.search over the initial query plan.
- Opened a bounded number of result URLs with web.fetch.
- Classified sources with source.classify and saved or rejected them with explicit reasons.
- Ranked source value with source.rank.
- Generated critique and next patch with trace.critic.
`;
await writeFile(path.join(runDir, "decision-log.md"), decisionLog);
event("artifact_created", {
  artifact: path.join(runDir, "decision-log.md"),
  reason: "Expose explicit rationale without depending on hidden model thoughts.",
});

const criticOutput = await runTool("trace.critic", {
  ask: task.ask,
  queryPlan,
  sourceDecisions,
}, "Critic reads saved trace outputs and proposes one concrete harness patch.") as {
  failureLabels: string[];
  assessment: string;
  patchTitle: string;
  patchRecommendation: string;
  nextTool: string;
};

const critic = `# Critic Report

Failure labels:

${criticOutput.failureLabels.map((label) => `- ${label}`).join("\n")}

Assessment:

${criticOutput.assessment}

Next harness change:

${criticOutput.patchRecommendation}
`;
await writeFile(path.join(runDir, "critic.md"), critic);
event("critic_note", {
  output: criticOutput.failureLabels,
  artifact: path.join(runDir, "critic.md"),
  reason: "trace.critic names the first harness limitation before the next run.",
});

const patch = `# Harness Patch Proposal

${criticOutput.patchTitle}

${criticOutput.patchRecommendation}
`;
await writeFile(path.join(runDir, "harness-patch.md"), patch);
event("harness_patch_proposed", {
  artifact: path.join(runDir, "harness-patch.md"),
  reason: "Make the next implementation step concrete and reviewable.",
});
await appendSession("critic", {
  failures: criticOutput.failureLabels,
  nextTool: criticOutput.nextTool,
  artifacts: ["critic.md", "harness-patch.md"],
});

event("run_completed", {
  output: { runDir },
  reason: "Starter run finished with trace, decision log, critic report, and patch proposal.",
});

await writeJson(path.join(runDir, "task.json"), task);
await writeArtifactIndex();
await savePoint("run_completed", { runDir });
await writeTrace();

console.log("research-agent-starter-ok");
console.log(runDir);

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function runSearches(queries: string[]) {
  const all: (SearchResult & { query: string })[] = [];
  for (const query of queries) {
    const results = await runTool("web.search", { query, limit: 5 }, "Search is an explicit tool call so the trace shows what query produced each lead.") as SearchResult[];
    event("searched", {
      input: query,
      output: results.map(({ title, url }) => ({ title, url })),
      reason: "Persist the result list before choosing sources to open.",
    });
    all.push(...results.map((result) => ({ ...result, query })));
  }
  return dedupeByUrl(all);
}

async function inspectSearchResults(results: (SearchResult & { query: string })[]) {
  const decisions: SourceDecisionRecord[] = [];
  for (const result of results) {
    try {
      event("opened_url", {
        url: result.url,
        input: { title: result.title, query: result.query },
        reason: "Open promising search results before deciding whether to save or reject them.",
      });
      const fetched = await runTool("web.fetch", { url: result.url, maxChars: 8000 }, "Fetch source text through the tool runner so artifacts and failures can be audited.");
      const decision = await runTool("source.classify", { result, fetched }, "Classify source quality separately from fetching so source taste can be tuned.") as SourceDecisionRecord;
      const rank = await runTool("source.rank", { result, fetched, decision }, "Rank saved and rejected sources so the critic can inspect research value.") as Record<string, unknown>;
      const artifact = path.join(runDir, "artifacts", `source-${decisions.length + 1}.json`);
      await writeJson(artifact, { result, fetched, decision, rank });
      event(decision.decision === "saved" ? "source_saved" : "source_rejected", {
        url: result.url,
        output: { ...decision, rank },
        artifact,
        reason: decision.reason,
        failure: decision.failure,
      });
      decisions.push({ ...result, ...decision, rank, artifact });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision: Pick<SourceDecisionRecord, "decision" | "reason" | "failure"> = {
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

function dedupeByUrl<T extends { url: string }>(results: T[]): T[] {
  const seen = new Set();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}
