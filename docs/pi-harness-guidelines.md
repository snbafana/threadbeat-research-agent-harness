# Pi Harness Implementation Guidelines

These are the rules for turning this repo into a Pi-backed research agent while keeping Threadbeat's outer model small and inspectable.

## North Star

Use Pi as the inner agent loop and harness engine, but make this repository own the research contract:

- what tools exist;
- when tools are allowed;
- what each tool must persist;
- how session state reloads;
- what evidence a human can review;
- how failures become the next harness edit.

Threadbeat should continue to see a simple execution unit: a task enters, events and artifacts come out. Pi can manage turns, messages, hooks, tool execution, and save points inside that unit.

## Architecture Boundary

Keep three layers separate:

- **Threadbeat worker**: creates task payloads, starts the sandbox, streams events, commits/pushes run artifacts, and tears down external resources.
- **Research harness**: loads `agent.json`, owns run/session directories, normalizes tools, records trace events, enforces save points, and writes review artifacts.
- **Pi agent loop**: plans, calls tools, receives tool results, decides whether to continue, and emits model/tool events.

Do not move Pi concepts like turns, attempts, or provider registries into Threadbeat core until repeated real runs prove the outer `tasks` and `events` model cannot represent the behavior.

## Session Durability

Durability is a harness feature, not a sandbox feature. A sandbox may die; the session must survive.

Persist these files per run or resumable session:

- `task.json`: original Threadbeat payload.
- `session.jsonl`: normalized user, assistant, tool-call, tool-result, and harness messages.
- `trace.jsonl`: reviewable event stream with reasons and failure labels.
- `artifacts/`: raw fetched pages, PDFs, screenshots, extracted text, translations, source decisions, and final reports.
- `harness-patch.md`: one concrete proposed change after each run.

Do not persist hidden chain of thought. Persist decision summaries, tool inputs/outputs, source evidence, critic notes, and explicit uncertainty.

## Turn Snapshots

Every Pi turn should run from a frozen snapshot:

- model and reasoning configuration;
- active tools;
- system prompt and loaded resources;
- current session messages;
- allowed credentials and sandbox paths;
- run metadata.

Runtime config changes made during a turn should affect the next turn, not mutate an in-flight provider request.

## Save Points

The harness must define deterministic save points. The default save point is after assistant output and all tool-result messages for that turn are persisted.

At each save point:

- flush pending session writes;
- flush trace events;
- sync artifact indexes;
- evaluate stop conditions;
- refresh the next turn snapshot if the agent continues.

This is the main durability primitive for days-long agents. Do not rely on a live process being uninterrupted.

## Tool Contract

Every tool should have:

- stable name, for example `web.search`, `browser.open`, `pdf.extract`, `translate.text`;
- description;
- argument schema;
- output schema or documented shape;
- explicit artifact writes where the output is large or source-like;
- bounded trace summary so logs stay readable;
- failure code mapping.

The harness should emit at least:

- `tool_started`;
- `tool_completed`;
- `tool_failed`;
- domain event, such as `searched`, `opened_url`, `translated`, or `source_saved`.

Tools should be adapter-friendly. The same tool contract should be exposable as a Pi tool, MCP tool, opencode-style plugin tool, or local deterministic test tool.

## Research Tool Tiers

Build tools in tiers so quality improves without rewriting the harness:

- **Tier 0**: deterministic local tools for smoke tests: web search, web fetch, source classifier.
- **Tier 1**: source preservation: raw HTML, PDF download, screenshot, text extraction, content hash, citation metadata.
- **Tier 2**: browser/device tools: logged-in browser, DOM snapshot, screenshot, click/type/download, network capture where available.
- **Tier 3**: research intelligence: query expansion, local-language translation, source-rank critics, contradiction detection, depth scoring.
- **Tier 4**: self-improvement: trace critic proposes prompt/tool/schema diffs; human accepts or rejects; accepted changes land as commits.

Each tier must have an end-to-end smoke before being used in a long-running agent.

## Hooks

Use Pi hooks for harness policy, not one-off conditionals scattered across tools.

Useful hook points:

- before tool call: permission, credential allowlist, query budget, domain allow/deny.
- after tool call: artifact completeness, output redaction, source quality checks.
- after turn: stop/continue decision, trace critic, save point.
- on failure: classify failure, preserve partial artifact, decide retry versus stop.

Hooks should receive a small context object with run id, session id, artifact directory, task metadata, and a trace writer. Avoid handing hooks raw mutable internals.

## Stop Conditions

Long-running research needs explicit stop conditions:

- enough primary sources found;
- no new leads after N search/frontier expansions;
- repeated translation or fetch failures;
- budget/time/domain limits reached;
- critic says current evidence does not support further useful search;
- human heartbeat asks the agent to pivot or stop.

Every stop must write a reason and a next-step recommendation.

## Critic Loop

The critic should evaluate traces and artifacts, not hidden model state.

Minimum critic output:

- what the agent was trying to prove or find;
- strongest saved sources;
- weakest or suspicious saved sources;
- missed-source hypotheses;
- failure labels;
- one patch recommendation.

Self-updating is allowed only through reviewable diffs. The agent can propose edits; the harness should commit accepted changes separately from run artifacts.

## Credential And Sandbox Policy

Credentials enter through allowlisted environment variables or mounted secret files. Tools must not print secrets into trace events, artifacts, or stdout.

Sandbox state is disposable:

- clone repo;
- inject allowlisted credentials;
- run task;
- persist session/artifacts/git diff externally;
- clean up sandbox.

If an agent must run for days, use durable session state plus restartable sandboxes. Do not depend on a single sandbox process staying alive.

## Testing Standard

Every harness capability needs a smoke that exercises the real boundary:

- local deterministic smoke for tool lifecycle;
- Pi smoke with a faux provider for turn/session/save-point logic;
- network smoke for search/fetch/PDF behavior;
- browser smoke for authenticated or device workflows;
- Threadbeat smoke that creates a task, streams events, commits artifacts, and cleans up the sandbox.

Prefer focused tests over one large harness test file.

## Promotion Rule

Keep this repo as the experimentation surface. Promote to Threadbeat core only when:

- the same capability repeats across at least two real runs;
- the event/artifact shape is stable;
- the smoke covers the real external path;
- the implementation can replace a script without losing coverage;
- the promoted abstraction still fits `tasks` and `events`.

## Immediate Build Order

1. Keep the existing manifest/tool runner and harden it with `tool_failed` events. Done.
2. Add file-backed session storage and save points. Done.
3. Add a Pi adapter that maps `researchTools` into Pi tool definitions. Done.
4. Move harness/tool implementation to TypeScript with `tsc --noEmit` contract checks. Done.
5. Add source-rank and query-expansion tools. Done.
6. Add a faux-provider Pi smoke so the model loop is testable without network/model calls.
7. Add a trace critic that proposes `harness-patch.md` from actual run artifacts. Done.
8. Add browser.snapshot for thin fetch retry and screenshot/text preservation. Done.
9. Add PDF preservation and best-effort text extraction. Done.
10. Add frontier-next leads from source decisions. Done.
11. Add translation preservation for local-language queries. Done.
12. Add batch-run trajectory tooling and stronger source frontier expansion.
