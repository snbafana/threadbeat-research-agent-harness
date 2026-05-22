#!/usr/bin/env node
import assert from "node:assert/strict";
import { runPiLoop } from "../tools/pi-loop.ts";

const result = await runPiLoop({ ask: "China province planning maps" });

assert.ok(result.events.includes("agent_start"));
assert.ok(result.events.includes("tool_execution_start"));
assert.ok(result.events.includes("tool_execution_end"));
assert.ok(result.events.includes("agent_end"));
assert.equal(result.pendingResponses, 0);

console.log(JSON.stringify({ ok: true, smoke: "pi-loop", events: result.eventCount }, null, 2));
