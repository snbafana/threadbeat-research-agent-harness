# Hermes Agent Inspiration

Source checked: `NousResearch/hermes-agent`, cloned to `/tmp/hermes-agent-study`.

Hermes is useful inspiration because it treats an agent as an always-available operating surface, not only a one-shot CLI. The parts worth copying into this research harness are below.

## What To Copy

- **Tool registry with availability checks**: Hermes tools self-register into a central registry with toolset membership, schemas, handlers, availability checks, result limits, and dynamic schema overrides.
- **Large result persistence**: Hermes persists oversized tool outputs to sandbox files and gives the model a preview plus a path, instead of flooding context or losing data.
- **Activity heartbeats**: long-running environment calls periodically report liveness so gateways do not kill apparently idle work.
- **Multiple environments**: local, Docker, SSH, Singularity, Modal, Daytona, and Vercel-style backends are treated as execution environments behind one interface.
- **Batch trajectories**: batch runner output includes resumable checkpoints, normalized tool stats, tool error counts, and trajectory data for later training/evaluation.
- **Self-improving memory and skills**: experience becomes reusable skill/memory artifacts, but through explicit persisted files rather than hidden state.
- **Gateway/cron surface**: agents are reachable through CLI and messaging gateways, with cron/scheduled jobs as a first-class path.
- **Security boundaries**: command approvals, path security, URL safety, credential files, secret redaction, and tool availability checks are not optional add-ons.

## What Not To Copy Yet

- Do not port the whole tool universe into Threadbeat core.
- Do not make Threadbeat understand every Hermes environment/backend.
- Do not add a plugin system before two or more real runs prove the tool contract needs dynamic loading.

## Research Harness Translation

For this repo, the Hermes ideas become:

- a typed `ResearchTool` contract;
- `agent.json` as the first manifest;
- file-backed `session.jsonl`, `trace.jsonl`, and artifact indexes;
- `tool_started`, `tool_completed`, `tool_failed`, and `save_point` events;
- tool output previews in trace/session, full raw output in artifacts;
- one-minute heartbeat iteration in Codex while the harness is still evolving;
- later: a batch run command that repeats simple research prompts, records tool stats, and proposes one harness patch per run.

## Tool Roadmap

Current implemented tools:

- `query.expand`
- `web.search`
- `web.fetch`
- `browser.snapshot`
- `pdf.extract`
- `source.classify`
- `source.rank`
- `frontier.next`
- `trace.critic`

Next concrete tools:

- `artifact.write`: persist raw/source outputs with content hashes and preview references.
- `translate.text`: preserve original and translated text with uncertainty notes.
- `trace.critic`: read trace/session/artifacts and propose one harness patch.
- `batch.run`: run repeated tasks, aggregate tool stats, and compare traces across runs.

Longer-term adapters:

- Pi tool adapter for real model loops.
- MCP adapter for Claude/Codex/opencode-compatible tool exposure.
- Daytona/Kubernetes sandbox adapter for restartable cloud execution.

Runtime note: `browser.snapshot` uses Playwright when Chromium is installed. In a fresh sandbox, run `npm run install:browsers` during setup. If Chromium is unavailable, the tool records `mode: fallback_fetch` and a `browser_unavailable` trace failure instead of pretending it captured a real browser snapshot.
