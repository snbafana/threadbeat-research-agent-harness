#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolRunner } from "../tools/research-tools.ts";

const artifactDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-source-archive-"));

try {
  const events: Array<Record<string, unknown>> = [];
  const runTool = createToolRunner({
    enabledTools: ["source.archive"],
    event(action, data) {
      events.push({ action, ...data });
    },
  });

  const result = await runTool("source.archive", {
    artifactDir,
    index: 1,
    result: {
      title: "Official planning source",
      url: "https://example.gov/planning.pdf",
      snippet: "map and planning document",
    },
    fetched: {
      url: "https://example.gov/planning.pdf",
      title: "Official planning source",
      text: "A long enough source preview about planning maps and official spatial planning.",
      charCount: 74,
    },
    pdf: {
      pdfArtifact: path.join(artifactDir, "planning.pdf"),
      textArtifact: path.join(artifactDir, "planning.txt"),
    },
    decision: {
      decision: "saved",
      sourceType: "government",
      reason: "official source",
    },
    rank: {
      score: 90,
      value: "high",
    },
  }, "Exercise source-specific archive persistence.") as {
    artifact: string;
    metadataArtifact: string;
    sha256: string;
    sourceArtifacts: string[];
  };

  const archive = JSON.parse(await readFile(result.artifact, "utf8"));
  const metadata = JSON.parse(await readFile(result.metadataArtifact, "utf8"));

  assert.ok(events.some((event) => event.action === "tool_started" && event.tool === "source.archive"));
  assert.ok(events.some((event) => event.action === "tool_completed" && event.tool === "source.archive"));
  assert.equal(archive.citation.url, "https://example.gov/planning.pdf");
  assert.equal(archive.decision.decision, "saved");
  assert.equal(metadata.sha256, result.sha256);
  assert.equal(result.sourceArtifacts.length, 2);

  console.log(JSON.stringify({ ok: true, smoke: "source-archive" }, null, 2));
} finally {
  await rm(artifactDir, { recursive: true, force: true });
}
