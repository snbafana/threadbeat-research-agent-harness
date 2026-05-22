# Harness Study Notes

Date: 2026-05-22

Question: should research capability be a hand-written `.mjs` script, or should it look like Codex, Claude Code, opencode, Amp, and Pi-style harnesses?

## Working Answer

The useful abstraction is not the file extension. Node `.mjs` is fine as an implementation target, especially because it is portable inside Threadbeat/Daytona sandboxes, but the agent should not hide research behavior inside ad hoc fetch calls. The durable contract should be:

- a manifest declares the agent entrypoint and enabled tools;
- each tool has a stable name, description, argument schema, and `execute(args, context)`;
- the harness owns tool lifecycle events, artifact persistence, session/run state, and save points;
- traces record tool inputs, bounded outputs, artifacts, failures, and reviewer-facing reasons;
- model/provider-specific search is an adapter, not the research policy.

## Codex

Local clone: `/tmp/agent-harness-study/codex`.

Codex treats web search as a configured model/tool capability rather than a local scraper. Relevant files:

- `codex-rs/tui/src/cli.rs`: CLI flag enables live web search and exposes the native Responses `web_search` tool.
- `codex-rs/tools/src/tool_spec.rs`: serializes tool specs, including `web_search`.
- `codex-rs/core/src/session/turn_context.rs`: resolves per-turn web search mode from config and permissions.
- `codex-rs/mcp-server/src/message_processor.rs`: implements `tools/list` and `tools/call` for MCP.

Takeaway: the harness should separate search availability from search policy. A web search call is a typed tool event in the trace, not invisible agent logic.

## opencode

Local clone: `/tmp/agent-harness-study/opencode`.

opencode plugin tools are close to the shape we want. `packages/plugin/src/tool.ts` defines a tool as:

- `description`;
- `args` schema;
- `execute(args, context)`;
- context with session id, message id, agent, directory, worktree, abort signal, metadata, and permission prompts.

Example: `.opencode/tool/github-pr-search.ts` exports a named custom tool that searches GitHub and returns LLM-friendly output. `.opencode/agent/duplicate-pr.md` enables exactly that tool in agent frontmatter.

Takeaway: the research agent should have named tools enabled by manifest/prompt, not a hardcoded set of side effects.

## Claude Code

Source: current Claude Code docs on MCP, hooks, custom tools, and plugins.

Claude Code's extension model is also a tool/harness boundary, not random functions embedded in the agent body:

- custom tools are exposed through MCP servers, including in-process MCP servers in the Agent SDK;
- hooks attach deterministic checks or actions to lifecycle events such as tool use;
- plugins package skills, agents, hooks, and MCP servers;
- MCP tools show up in tool events, so `PreToolUse`, `PostToolUse`, permission, and failure hooks can observe them.

Takeaway: if we want Claude/Codex/opencode/Pi compatibility, our repo-local tool shape should be close enough to map into MCP later. The harness should preserve tool names, inputs, outputs, artifacts, and failures as first-class events.

## Pi

Local clone: `/tmp/agent-harness-study/pi-mono`.

Pi has the most directly useful harness concepts:

- `packages/agent/README.md`: `Agent` accepts state with system prompt, model, tools, and messages; subscribers receive tool execution events.
- `packages/agent/docs/agent-harness.md`: `AgentHarness` owns session persistence, runtime config, turn snapshots, operation phases, resource resolution, and save points.
- `packages/agent/docs/hooks.md`: hooks are typed events with reducers and mutation semantics.
- `packages/ai/src/types.ts`: streaming events include tool-call start/delta/end.

Takeaway: Threadbeat should keep `tasks` and `events` as the product model, but this repo should model the inner agent as a session/harness with save points. That lets us later swap the deterministic local planner for a Pi model loop while preserving the same tools and traces.

## Amp

Amp appears primarily consumable as a CLI/product, with public contribution material under Sourcegraph repos such as `sourcegraph/amp-contrib`. In the Centaur code previously inspected, Amp is wrapped as a process/thread CLI rather than extended as a first-class library. That suggests Amp belongs behind a provider adapter, not as the first harness foundation.

Takeaway: for our own research agent, prefer an explicit local tool/session contract now. Add Amp/Codex/Claude/opencode as runnable adapters later.

## Implementation Direction

Immediate harness shape:

- `agent.json`: declares the agent, entrypoint, enabled tools, trace schema, and save-point policy.
- `tools/`: contains implementation modules, but each tool is invoked through one runner.
- `threadbeat-agent.mjs`: loads task, creates run directory, calls named tools, emits `tool_started` and `tool_completed`, saves artifacts, and produces reviewable trace outputs.
- `scripts/local-smoke.mjs`: proves the tool lifecycle end to end.

This keeps Node as a cheap implementation substrate while copying the important harness boundary from Codex/opencode/Pi.
