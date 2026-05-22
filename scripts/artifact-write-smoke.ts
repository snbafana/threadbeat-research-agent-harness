#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolRunner } from "../tools/research-tools.ts";

const artifactDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-artifact-write-"));

try {
  const events: Array<Record<string, unknown>> = [];
  const runTool = createToolRunner({
    enabledTools: ["artifact.write"],
    event(action, data) {
      events.push({ action, ...data });
    },
  });

  const result = await runTool("artifact.write", {
    artifactDir,
    name: "source map",
    format: "json",
    content: {
      task: "artifact smoke",
      sources: [{ title: "official source", url: "https://example.gov/a.pdf" }],
    },
  }, "Exercise hash-backed artifact persistence.") as {
    artifact: string;
    metadataArtifact: string;
    sha256: string;
    preview: string;
  };

  const body = await readFile(result.artifact);
  const metadata = JSON.parse(await readFile(result.metadataArtifact, "utf8"));

  assert.ok(events.some((event) => event.action === "tool_started" && event.tool === "artifact.write"));
  assert.ok(events.some((event) => event.action === "tool_completed" && event.tool === "artifact.write"));
  assert.equal(result.sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(metadata.sha256, result.sha256);
  assert.match(result.preview, /official source/);

  console.log(JSON.stringify({ ok: true, smoke: "artifact-write" }, null, 2));
} finally {
  await rm(artifactDir, { recursive: true, force: true });
}
