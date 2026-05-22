#!/usr/bin/env node
import assert from "node:assert/strict";
import { createToolRunner } from "../tools/research-tools.ts";

const events: Array<Record<string, unknown>> = [];
const runTool = createToolRunner({
  enabledTools: ["model.critic"],
  event(action, data) {
    events.push({ action, ...data });
  },
});

const result = await runTool("model.critic", {
  ask: "Find durable province planning map sources.",
  queryPlan: [
    "province planning maps",
    "province planning maps primary sources",
    "province planning maps 国土空间规划 地图 pdf",
    "province planning maps 自然资源局 控制性详细规划",
  ],
  sourceDecisions: [
    {
      title: "Planning map PDF",
      url: "https://example.gov/planning-map.pdf",
      decision: "saved",
      reason: "Official planning map PDF signal.",
      rank: { score: 85, value: "high", followUp: ["search the named planning phrase in Chinese"] },
    },
  ],
}, "Exercise Pi-backed critic loop through the typed tool runner.") as {
  nextTool: string;
  modelEvents: string[];
  pendingResponses: number;
};

assert.ok(events.some((event) => event.action === "tool_started" && event.tool === "model.critic"));
assert.ok(events.some((event) => event.action === "tool_completed" && event.tool === "model.critic"));
assert.ok(result.modelEvents.includes("agent_start"));
assert.ok(result.modelEvents.includes("tool_execution_start"));
assert.ok(result.modelEvents.includes("tool_execution_end"));
assert.ok(result.modelEvents.includes("agent_end"));
assert.equal(result.pendingResponses, 0);
assert.equal(result.nextTool, "source.compare");

console.log(JSON.stringify({ ok: true, smoke: "model-critic", events: result.modelEvents.length }, null, 2));
