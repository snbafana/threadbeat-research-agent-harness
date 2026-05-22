#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRunState } from "../harness/run-state.ts";
import { createToolRunner } from "../tools/research-tools.ts";

const runDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-tool-smoke-"));

try {
  const state = await createRunState({ runDir });
  const runTool = createToolRunner({
    enabledTools: ["always.fail"],
    event: state.event,
    appendSession: state.appendSession,
    tools: [
      {
        name: "always.fail",
        description: "Fails deterministically for tool failure smoke coverage.",
        parameters: { type: "object", properties: {} },
        async execute() {
          throw new Error("expected failure");
        },
      },
    ],
  });

  await assert.rejects(
    () => runTool("always.fail", { sample: true }, "Exercise the tool failure trace path."),
    /expected failure/,
  );
  await state.writeTrace();

  assert.ok(state.trace.some((event) => event.action === "tool_failed" && event.tool === "always.fail"));
  const session = await readFile(path.join(runDir, "session.jsonl"), "utf8");
  assert.match(session, /"kind":"tool_call"/);
  assert.match(session, /"failure":"tool_execution_failed"/);

  console.log(JSON.stringify({ ok: true, smoke: "tool-runner" }, null, 2));
} finally {
  await rm(runDir, { recursive: true, force: true });
}
