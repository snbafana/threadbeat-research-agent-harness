import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BatchRunResult {
  batchDir: string;
  runs: BatchRunItem[];
  summaryArtifact: string;
}

export interface BatchRunItem {
  ask: string;
  runDir: string;
  traceEvents: number;
  savedSources: number;
  rejectedSources: number;
  handoffTarget: string;
}

export async function batchRun({
  asks,
  batchDir = path.join("runs", "batches", new Date().toISOString().replace(/[:.]/g, "-")),
}: {
  asks: string[];
  batchDir?: string;
}): Promise<BatchRunResult> {
  if (!asks.length) throw new Error("batch.run requires at least one ask");
  await mkdir(batchDir, { recursive: true });
  const runs: BatchRunItem[] = [];

  for (const [index, ask] of asks.entries()) {
    const taskPath = path.join(batchDir, `task-${index + 1}.json`);
    await writeFile(taskPath, `${JSON.stringify({ ask, inputs: { batch: true } }, null, 2)}\n`);
    const output = execFileSync("node", ["threadbeat-agent.mjs", taskPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runDir = output.match(/runs\/[^\s]+/)?.[0];
    if (!runDir) throw new Error(`could not find run dir in output: ${output}`);
    runs.push(await summarizeRun(ask, runDir));
  }

  const summaryArtifact = path.join(batchDir, "summary.json");
  await writeFile(summaryArtifact, `${JSON.stringify({ batchDir, runs }, null, 2)}\n`);
  return { batchDir, runs, summaryArtifact };
}

async function summarizeRun(ask: string, runDir: string): Promise<BatchRunItem> {
  const trace = (await readFile(path.join(runDir, "trace.jsonl"), "utf8")).trim().split("\n");
  const sourceDecisions = JSON.parse(await readFile(path.join(runDir, "artifacts", "source-decisions.json"), "utf8")) as Array<{ decision: string }>;
  const resumePlan = JSON.parse(await readFile(path.join(runDir, "artifacts", "resume-plan.json"), "utf8")) as { nextTool?: string };
  return {
    ask,
    runDir,
    traceEvents: trace.length,
    savedSources: sourceDecisions.filter((source) => source.decision === "saved").length,
    rejectedSources: sourceDecisions.filter((source) => source.decision === "rejected").length,
    handoffTarget: resumePlan.nextTool ?? "external.critic",
  };
}
