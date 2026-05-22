# Research Agent Harness

This is the first minimal Threadbeat agent implementation scaffold. It is not a
browser runtime yet. It is a versioned harness for learning what the agent did,
why it failed, and what should change before the next run.

The contract is the existing Threadbeat agent contract:

- Threadbeat writes `.threadbeat/task.json`.
- The repo exposes `threadbeat-agent.mjs`.
- The agent writes trace/review/artifacts into the repo.
- Threadbeat commits and pushes the task branch as `runs/{task_id}`.

## Harness Direction

Pi should become the inner agent loop, but this repo owns the durable research
contract around tools, traces, artifacts, session reload, and reviewable failure
labels. See `docs/pi-harness-guidelines.md` for the implementation standard and
`docs/harness-study.md` for notes from Codex, Claude Code, opencode, Amp, and Pi.

## Local Smoke

```bash
npm run smoke
```

The local smoke injects a task, runs the agent, and verifies the expected
trace/review files. In Threadbeat, the worker commits these run artifacts to a
`runs/{task_id}` branch after the agent exits.

## What To Inspect

- `runs/<run_id>/trace.jsonl`: every reviewable action or decision.
- `runs/<run_id>/decision-log.md`: explicit rationale, not hidden model thoughts.
- `runs/<run_id>/critic.md`: failure labels and next harness changes.
- `runs/<run_id>/harness-patch.md`: concrete edits to prompts/schema/tools.
- Git diff between runs: macro changes in the harness.

Promote only repeated patterns into Threadbeat core. Until then, keep this as an
agent repo shape that rides the existing `tasks` and `events` path.
