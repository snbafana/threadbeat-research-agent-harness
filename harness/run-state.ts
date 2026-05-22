import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TraceEvent {
  time: string;
  action: string;
  [key: string]: unknown;
}

export async function createRunState({ runDir }: { runDir: string }) {
  await mkdir(path.join(runDir, "artifacts"), { recursive: true });
  const trace: TraceEvent[] = [];
  let sessionSeq = 0;

  async function appendSession(kind: string, data: Record<string, unknown>) {
    const entry = {
      seq: ++sessionSeq,
      time: new Date().toISOString(),
      kind,
      ...data,
    };
    await appendFile(path.join(runDir, "session.jsonl"), `${JSON.stringify(entry)}\n`);
    return entry;
  }

  function event(action: string, data: Record<string, unknown>) {
    trace.push({
      time: new Date().toISOString(),
      action,
      ...data,
    });
  }

  async function savePoint(name: string, data: Record<string, unknown>) {
    event("save_point", {
      output: { name, ...data },
      reason: `Persisted session and trace at save point: ${name}.`,
    });
    await appendSession("save_point", { name, ...data });
    await writeTrace();
    await writeArtifactIndex();
  }

  async function writeTrace() {
    await writeFile(path.join(runDir, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
  }

  async function writeArtifactIndex() {
    const artifactDir = path.join(runDir, "artifacts");
    const files = await readdir(artifactDir).catch(() => []);
    await writeFile(path.join(artifactDir, "index.json"), `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      files: files.filter((file) => file !== "index.json").sort(),
    }, null, 2)}\n`);
  }

  return {
    appendSession,
    event,
    savePoint,
    trace,
    writeArtifactIndex,
    writeTrace,
  };
}
