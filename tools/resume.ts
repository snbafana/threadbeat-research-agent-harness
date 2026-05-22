import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface ResumePlanInput {
  runDir: string;
  nextTool: string;
  heartbeatIntervalMinutes?: number;
}

interface RunEvent {
  action?: string;
  time?: string;
  tool?: string;
  output?: unknown;
  artifact?: string;
}

interface SessionEntry {
  kind?: string;
  name?: string;
  time?: string;
  seq?: number;
  [key: string]: unknown;
}

export interface ResumePlan {
  runDir: string;
  nextTool: string;
  lastSavePoint: string | null;
  lastAction: string | null;
  heartbeatIntervalMinutes: number;
  shouldResume: boolean;
  resumePrompt: string;
  restartCommand: string;
  requiredArtifacts: string[];
  stopConditions: string[];
  artifact: string;
}

export async function planResume({
  runDir,
  nextTool,
  heartbeatIntervalMinutes = 1,
}: ResumePlanInput): Promise<ResumePlan> {
  const trace = await readJsonl<RunEvent>(path.join(runDir, "trace.jsonl"));
  const session = await readJsonl<SessionEntry>(path.join(runDir, "session.jsonl"));
  const artifactIndex = await readJson(path.join(runDir, "artifacts", "index.json"));
  const lastSavePoint = [...session].reverse().find((entry) => entry.kind === "save_point");
  const lastAction = [...trace].reverse().find((event) => event.action)?.action ?? null;
  const artifactFiles = Array.isArray(artifactIndex?.files) ? artifactIndex.files.filter((item): item is string => typeof item === "string") : [];
  const requiredArtifacts = [
    "source-map.json",
    "source-decisions.json",
    "search-results.json",
    ...artifactFiles.filter((file) => file.endsWith(".pdf") || file.endsWith(".png")).slice(0, 3),
  ];
  const resumePrompt = [
    `Resume ${runDir} from save point ${lastSavePoint?.name ?? "unknown"}.`,
    `Handoff target: ${nextTool}.`,
    "Read task.json, session.jsonl, trace.jsonl, decision-log.md, artifacts/source-map.json, and artifacts/source-decisions.json before acting.",
    "Do not rely on hidden chain of thought; use the persisted decision log and artifacts.",
  ].join(" ");
  const plan: ResumePlan = {
    runDir,
    nextTool,
    lastSavePoint: typeof lastSavePoint?.name === "string" ? lastSavePoint.name : null,
    lastAction,
    heartbeatIntervalMinutes,
    shouldResume: lastAction !== "run_completed",
    resumePrompt,
    restartCommand: `node threadbeat-agent.mjs ${path.join(runDir, "task.json")}`,
    requiredArtifacts: [...new Set(requiredArtifacts)],
    stopConditions: [
      "stop if the artifact set cannot be read",
      "stop if the run is already externally reviewed",
      "stop if the evidence artifacts are insufficient for a concrete repo edit",
    ],
    artifact: path.join(runDir, "artifacts", "resume-plan.json"),
  };

  await mkdir(path.dirname(plan.artifact), { recursive: true });
  await writeFile(plan.artifact, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text ? JSON.parse(text) as Record<string, unknown> : null;
}
