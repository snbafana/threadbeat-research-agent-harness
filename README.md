# Research Agent Harness

This is the first minimal Threadbeat agent implementation scaffold. It is not a
browser runtime yet. It is a versioned harness for learning what the agent did,
what evidence it collected, and what a separate critic agent should inspect.

The contract is the existing Threadbeat agent contract:

- Threadbeat writes `.threadbeat/task.json`.
- The repo exposes `threadbeat-agent.mjs`.
- The agent writes trace, session, and evidence artifacts into the repo.
- Threadbeat commits and pushes the task branch as `runs/{task_id}`.
- A separate critic agent reads completed runs and edits this GitHub repo.

## Harness Direction

Pi should become the inner agent loop, but this repo owns the durable research
contract around tools, traces, artifacts, session reload, and reviewable evidence.
Critique and repo edits are external to the research agent. See `docs/pi-harness-guidelines.md` for the implementation standard and
`docs/harness-study.md` for notes from Codex, Claude Code, opencode, Amp, and Pi.
See `docs/hermes-inspiration.md` for the uptime, tool registry, sandbox, and
self-improvement ideas worth copying from Hermes Agent.

## Local Smoke

```bash
npm run smoke
```

The local smoke injects a task, runs the agent, and verifies the expected
trace/evidence files. In Threadbeat, the worker commits these run artifacts to a
`runs/{task_id}` branch after the agent exits.

## Heartbeat Data Room

```bash
npm run data-room:heartbeat
```

This is the first heartbeat durability check. The first run creates
`data-room/research-heartbeat`; each later run calls `web.search`, adds one new
person to `people.json`, and appends the search tool trace to `tool-trace.jsonl`.

## What To Inspect

- `runs/<run_id>/trace.jsonl`: every reviewable action or decision.
- `runs/<run_id>/decision-log.md`: explicit rationale, not hidden model thoughts.
- `runs/<run_id>/artifacts/resume-plan.json`: heartbeat/restart prompt and command.
- `runs/<run_id>/artifacts/*.meta.json`: content hash, byte count, and preview metadata.
- Git diff between runs: macro changes in the harness.

Promote only repeated patterns into Threadbeat core. Until then, keep this as an
agent repo shape that rides the existing `tasks` and `events` path.
