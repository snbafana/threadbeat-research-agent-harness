#!/usr/bin/env node
import assert from "node:assert/strict";
import { createPiTools } from "../tools/pi-adapter.ts";
import type { ResearchTool } from "../tools/research-tools.ts";

const piTools = createPiTools({
  tools: [
    {
      name: "demo.echo",
      description: "Echoes input for Pi adapter smoke coverage.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
      },
      async execute(args: Record<string, unknown>) {
        return { echoed: args.text };
      },
    },
  ] satisfies ResearchTool[],
});

assert.equal(piTools.length, 1);
assert.ok(piTools[0]);
assert.equal(piTools[0].name, "demo.echo");
assert.equal(piTools[0].label, "demo.echo");
assert.equal(piTools[0].parameters.required?.[0], "text");

const updates: unknown[] = [];
const result = await piTools[0].execute(
  "tool-call-1",
  { text: "hello" },
  undefined,
  (update) => updates.push(update),
);

assert.equal(updates.length, 1);
assert.deepEqual(result.details.output, { echoed: "hello" });
assert.equal(result.content[0].type, "text");
assert.match(result.content[0].text, /hello/);

console.log(JSON.stringify({ ok: true, smoke: "pi-adapter" }, null, 2));
