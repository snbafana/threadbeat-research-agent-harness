import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { writeArtifact } from "./artifact.ts";
import { browserSnapshot } from "./browser.ts";
import { batchRun } from "./batch.ts";
import { pdfExtract } from "./pdf.ts";
import { createPiTools } from "./pi-adapter.ts";
import { runPiLoop } from "./pi-loop.ts";
import { planResume } from "./resume.ts";
import { translateText } from "./translation.ts";
import { webFetch, webSearch, type FetchedPage, type SearchResult } from "./web.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ToolEvent = (action: string, data: Record<string, unknown>) => void;
export type AppendSession = (kind: string, data: Record<string, unknown>) => Promise<unknown>;

export interface ToolSchema {
  type: string;
  required?: string[];
  properties?: Record<string, unknown>;
}

export interface ResearchTool<TArgs extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  name: string;
  description: string;
  parameters: ToolSchema;
  execute(args: TArgs): Promise<TOutput>;
}

interface SourceDecision {
  decision: "saved" | "rejected";
  reason: string;
  sourceType: string;
  textChars: number;
  failure: string | null;
}

interface RankedSource {
  score: number;
  value: "high" | "medium" | "low";
  reasons: string[];
  followUp: string[];
}

interface CriticInput {
  ask: string;
  queryPlan: string[];
  sourceDecisions: Array<{
    title: string;
    url: string;
    decision: "saved" | "rejected";
    reason: string;
    failure?: string | null;
    rank?: {
      score?: number;
      value?: "high" | "medium" | "low";
      followUp?: string[];
    };
  }>;
}

interface CriticOutput {
  failureLabels: string[];
  assessment: string;
  patchTitle: string;
  patchRecommendation: string;
  nextTool: string;
}

interface FrontierInput {
  ask: string;
  queryPlan: string[];
  sourceDecisions: Array<{
    title: string;
    url: string;
    decision: "saved" | "rejected";
    reason: string;
    sourceType?: string;
    failure?: string | null;
    rank?: {
      score?: number;
      value?: "high" | "medium" | "low";
      followUp?: string[];
    };
  }>;
}

interface FrontierLead {
  query: string;
  reason: string;
  priority: "high" | "medium" | "low";
  sourceUrl?: string;
}

export const researchTools: ResearchTool[] = [
  {
    name: "query.expand",
    description: "Expand a research ask into bounded search queries, including primary-source and local-language variants.",
    parameters: {
      type: "object",
      required: ["ask"],
      properties: {
        ask: { type: "string" },
      },
    },
    async execute(args) {
      const { ask } = args as { ask: string };
      return expandQueries(ask);
    },
  },
  {
    name: "web.search",
    description: "Search the public web for candidate sources.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 5 },
      },
    },
    async execute(args) {
      const { query, limit = 5 } = args as { query: string; limit?: number };
      return await webSearch(query, { limit });
    },
  },
  {
    name: "web.fetch",
    description: "Fetch a URL and return extracted title/text for source triage.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        maxChars: { type: "number", default: 12000 },
      },
    },
    async execute(args) {
      const { url, maxChars = 12000 } = args as { url: string; maxChars?: number };
      return await webFetch(url, { maxChars });
    },
  },
  {
    name: "browser.snapshot",
    description: "Capture a browser-backed page snapshot, preserving screenshot/text artifacts when browser execution is available.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        artifactDir: { type: "string" },
        name: { type: "string" },
        maxChars: { type: "number", default: 12000 },
      },
    },
    async execute(args) {
      const { url, artifactDir, name, maxChars = 12000 } = args as {
        url: string;
        artifactDir?: string;
        name?: string;
        maxChars?: number;
      };
      return await browserSnapshot({ url, artifactDir, name, maxChars });
    },
  },
  {
    name: "pdf.extract",
    description: "Preserve a PDF, compute a content hash, and extract reviewable text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        filePath: { type: "string" },
        artifactDir: { type: "string" },
        name: { type: "string" },
        maxChars: { type: "number", default: 20000 },
      },
    },
    async execute(args) {
      const { url, filePath, artifactDir, name, maxChars = 20000 } = args as {
        url?: string;
        filePath?: string;
        artifactDir?: string;
        name?: string;
        maxChars?: number;
      };
      return await pdfExtract({ url, filePath, artifactDir, name, maxChars });
    },
  },
  {
    name: "translate.text",
    description: "Preserve original text and produce deterministic glossary-backed translation hints with uncertainty.",
    parameters: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        targetLanguage: { type: "string", default: "en" },
        artifactDir: { type: "string" },
        name: { type: "string" },
      },
    },
    async execute(args) {
      const { text, targetLanguage = "en", artifactDir, name } = args as {
        text: string;
        targetLanguage?: string;
        artifactDir?: string;
        name?: string;
      };
      return await translateText({ text, targetLanguage, artifactDir, name });
    },
  },
  {
    name: "source.classify",
    description: "Classify whether a fetched source is worth saving for research review.",
    parameters: {
      type: "object",
      required: ["result", "fetched"],
      properties: {
        result: { type: "object" },
        fetched: { type: "object" },
      },
    },
    async execute(args) {
      const { result, fetched } = args as { result: SearchResult; fetched: FetchedPage };
      return classifySource(result, fetched);
    },
  },
  {
    name: "source.rank",
    description: "Score a source decision for research value, verification strength, and follow-up potential.",
    parameters: {
      type: "object",
      required: ["result", "fetched", "decision"],
      properties: {
        result: { type: "object" },
        fetched: { type: "object" },
        decision: { type: "object" },
      },
    },
    async execute(args) {
      const { result, fetched, decision } = args as { result: SearchResult; fetched: FetchedPage; decision: SourceDecision };
      return rankSource(result, fetched, decision);
    },
  },
  {
    name: "frontier.next",
    description: "Convert source decisions and rankings into explicit next research leads.",
    parameters: {
      type: "object",
      required: ["ask", "queryPlan", "sourceDecisions"],
      properties: {
        ask: { type: "string" },
        queryPlan: { type: "array" },
        sourceDecisions: { type: "array" },
      },
    },
    async execute(args) {
      return nextFrontier(args as unknown as FrontierInput);
    },
  },
  {
    name: "batch.run",
    description: "Run the harness over a small set of asks and summarize trajectory artifacts for comparison.",
    parameters: {
      type: "object",
      required: ["asks"],
      properties: {
        asks: { type: "array" },
        batchDir: { type: "string" },
      },
    },
    async execute(args) {
      const { asks, batchDir } = args as { asks: string[]; batchDir?: string };
      return await batchRun({ asks, batchDir });
    },
  },
  {
    name: "pi.loop",
    description: "Run a deterministic Pi Agent loop against the research tool adapter using a faux provider.",
    parameters: {
      type: "object",
      required: ["ask"],
      properties: {
        ask: { type: "string" },
      },
    },
    async execute(args) {
      const { ask } = args as { ask: string };
      return await runPiLoop({ ask });
    },
  },
  {
    name: "trace.critic",
    description: "Review the trace-level run outputs and propose one concrete harness improvement.",
    parameters: {
      type: "object",
      required: ["ask", "queryPlan", "sourceDecisions"],
      properties: {
        ask: { type: "string" },
        queryPlan: { type: "array" },
        sourceDecisions: { type: "array" },
      },
    },
    async execute(args) {
      return critiqueTrace(args as unknown as CriticInput);
    },
  },
  {
    name: "model.critic",
    description: "Run the trace critic through a deterministic Pi Agent model loop and return the bounded patch proposal.",
    parameters: {
      type: "object",
      required: ["ask", "queryPlan", "sourceDecisions"],
      properties: {
        ask: { type: "string" },
        queryPlan: { type: "array" },
        sourceDecisions: { type: "array" },
      },
    },
    async execute(args) {
      return await modelCritique(args as unknown as CriticInput);
    },
  },
  {
    name: "resume.plan",
    description: "Write a restartable heartbeat plan from persisted run/session/trace artifacts.",
    parameters: {
      type: "object",
      required: ["runDir", "nextTool"],
      properties: {
        runDir: { type: "string" },
        nextTool: { type: "string" },
        heartbeatIntervalMinutes: { type: "number", default: 1 },
      },
    },
    async execute(args) {
      const { runDir, nextTool, heartbeatIntervalMinutes = 1 } = args as {
        runDir: string;
        nextTool: string;
        heartbeatIntervalMinutes?: number;
      };
      return await planResume({ runDir, nextTool, heartbeatIntervalMinutes });
    },
  },
  {
    name: "artifact.write",
    description: "Persist a reviewable artifact plus sha256 metadata and a bounded preview.",
    parameters: {
      type: "object",
      required: ["artifactDir", "name", "content"],
      properties: {
        artifactDir: { type: "string" },
        name: { type: "string" },
        content: {},
        format: { type: "string", enum: ["json", "text"] },
        sourceUrl: { type: "string" },
      },
    },
    async execute(args) {
      const { artifactDir, name, content, format, sourceUrl } = args as {
        artifactDir: string;
        name: string;
        content: JsonValue;
        format?: "json" | "text";
        sourceUrl?: string;
      };
      return await writeArtifact({ artifactDir, name, content, format, sourceUrl });
    },
  },
];

export function createToolRunner({
  enabledTools,
  event,
  appendSession = async () => {},
  tools = researchTools,
}: {
  enabledTools: string[];
  event: ToolEvent;
  appendSession?: AppendSession;
  tools?: ResearchTool[];
}) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const enabled = new Set(enabledTools);

  return async function runTool(name: string, args: Record<string, unknown>, reason: string): Promise<unknown> {
    if (!enabled.has(name)) throw new Error(`tool is not enabled: ${name}`);
    const tool = toolsByName.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);

    event("tool_started", {
      tool: name,
      input: redactedInput(args),
      reason,
    });
    await appendSession("tool_call", { tool: name, input: redactedInput(args), reason });
    try {
      const output = await tool.execute(args);
      const summary = summarizeToolValue(output);
      event("tool_completed", {
        tool: name,
        output: summary,
        reason: `Completed ${name}.`,
      });
      await appendSession("tool_result", { tool: name, output: summary });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      event("tool_failed", {
        tool: name,
        output: { message },
        reason: `Failed ${name}: ${message}`,
        failure: "tool_execution_failed",
      });
      await appendSession("tool_result", {
        tool: name,
        error: message,
        failure: "tool_execution_failed",
      });
      throw error;
    }
  };
}

function expandQueries(ask: string): string[] {
  const base = ask.trim();
  const queries = [
    base,
    `${base} primary sources`,
    `${base} maps planning documents local language terms`,
    `${base} government PDF map planning`,
  ];
  const lower = base.toLowerCase();
  const chinaSignals = ["china", "province", "prefecture", "county", "中国", "省", "市", "县"];
  if (chinaSignals.some((signal) => lower.includes(signal))) {
    queries.push(`${base} 国土空间规划 地图 pdf`);
    queries.push(`${base} 自然资源局 控制性详细规划`);
    queries.push(`${base} 政府信息公开 规划图`);
  }
  return [...new Set(queries)].slice(0, 8);
}

function classifySource(result: SearchResult, fetched: FetchedPage): SourceDecision {
  const haystack = `${result.title} ${result.snippet} ${fetched.title} ${fetched.text}`.toLowerCase();
  if (fetched.charCount < 500) {
    return {
      decision: "rejected",
      reason: "Fetched page produced too little extracted text to validate or quote.",
      sourceType: inferSourceType(haystack),
      textChars: fetched.charCount,
      failure: "failed_to_save_artifact",
    };
  }
  const primarySignals = ["gov", "government", "planning", "plan", "map", "pdf", "规划", "地图", "自然资源", "国土空间"];
  const weakSignals = ["wikipedia", "blog", "travel", "tourism", "tripadvisor"];
  const primaryScore = primarySignals.filter((signal) => haystack.includes(signal)).length;
  const weakScore = weakSignals.filter((signal) => haystack.includes(signal)).length;
  if (primaryScore > weakScore) {
    return {
      decision: "saved",
      reason: "Source contains primary-source or planning/map signals worth preserving for review.",
      sourceType: inferSourceType(haystack),
      textChars: fetched.charCount,
      failure: null,
    };
  }
  return {
    decision: "rejected",
    reason: "Source looks too generic unless it unlocks primary documents or local-language search terms.",
    sourceType: inferSourceType(haystack),
    textChars: fetched.charCount,
    failure: "trusted_weak_source",
  };
}

function rankSource(result: SearchResult, fetched: FetchedPage, decision: SourceDecision): RankedSource {
  const haystack = `${result.url} ${result.title} ${result.snippet} ${fetched.title} ${fetched.text}`.toLowerCase();
  const reasons: string[] = [];
  const followUp: string[] = [];
  let score = decision.decision === "saved" ? 20 : 0;

  if (haystack.includes(".gov") || haystack.includes("政府") || haystack.includes("自然资源")) {
    score += 35;
    reasons.push("government or official-source signal");
  }
  if (haystack.includes("pdf")) {
    score += 15;
    reasons.push("document/PDF signal");
  }
  if (haystack.includes("map") || haystack.includes("地图") || haystack.includes("规划图")) {
    score += 15;
    reasons.push("map/planning signal");
  }
  if (fetched.charCount >= 3000) {
    score += 10;
    reasons.push("substantial extracted text");
  }
  if (fetched.charCount < 500) {
    score -= 25;
    reasons.push("thin extracted text");
    followUp.push("retry with browser snapshot or alternate extractor");
  }
  if (haystack.includes("wikipedia") || haystack.includes("libguides") || haystack.includes("blog")) {
    score -= 10;
    reasons.push("secondary or guide-like source");
    followUp.push("use this only to discover primary-source leads");
  }
  if (haystack.includes("国土空间") || haystack.includes("控制性详细规划")) {
    followUp.push("search the named planning phrase in Chinese");
  }

  const bounded = Math.max(0, Math.min(100, score));
  return {
    score: bounded,
    value: bounded >= 70 ? "high" : bounded >= 40 ? "medium" : "low",
    reasons: reasons.length ? reasons : ["weak explicit source-quality signals"],
    followUp,
  };
}

function critiqueTrace({ ask, queryPlan, sourceDecisions }: CriticInput): CriticOutput {
  const saved = sourceDecisions.filter((source) => source.decision === "saved");
  const rejected = sourceDecisions.filter((source) => source.decision === "rejected");
  const highValue = saved.filter((source) => source.rank?.value === "high");
  const thin = sourceDecisions.filter((source) => source.failure === "failed_to_save_artifact" || (source.rank?.score ?? 0) < 40);
  const labels = new Set<string>();

  if (queryPlan.length < 4) labels.add("bad_query_language");
  if (saved.length === 0) labels.add("missed_primary_source");
  if (saved.length > 0) labels.add("stopped_too_early");
  if (thin.length > 0) labels.add("failed_to_save_artifact");
  if (highValue.length === 0) labels.add("trusted_weak_source");

  const nextTool = "source.archive";
  return {
    failureLabels: [...labels],
    assessment: [
      `Task: ${ask}`,
      `Queries: ${queryPlan.length}. Saved sources: ${saved.length}. Rejected sources: ${rejected.length}.`,
      highValue.length
        ? `Best signal: ${highValue[0]?.title} (${highValue[0]?.url}).`
        : "No clearly high-value source was established by the current scoring pass.",
      thin.length
        ? "At least one source needs a stronger capture path because extraction or rank was weak."
        : "The next improvement should deepen source preservation beyond HTML text.",
    ].join("\n"),
    patchTitle: `Add ${nextTool} to close the next research gap`,
    patchRecommendation: [
      `Implement ${nextTool} as a typed tool.`,
      "It must emit tool lifecycle events, save a raw artifact, write a bounded trace summary, and update source decisions with a follow-up lead.",
      "Keep it inside this harness until repeated runs prove the interface belongs in Threadbeat core.",
    ].join("\n"),
    nextTool,
  };
}

async function modelCritique(input: CriticInput): Promise<CriticOutput & {
  modelMode: "faux";
  modelEvents: string[];
  modelEventCount: number;
  pendingResponses: number;
}> {
  const faux = registerFauxProvider();
  const modelEvents: string[] = [];

  try {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("I will inspect the trace with the bounded critic tool."),
          fauxToolCall("trace.critic", input, { id: "model-critic-tool-call-1" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The patch proposal is ready."),
    ]);

    const tools = createPiTools({
      tools: [
        {
          name: "trace.critic",
          description: "Bounded trace critic used by the Pi-backed model critic.",
          parameters: {
            type: "object",
            required: ["ask", "queryPlan", "sourceDecisions"],
            properties: {
              ask: { type: "string" },
              queryPlan: { type: "array" },
              sourceDecisions: { type: "array" },
            },
          },
          async execute(args: Record<string, unknown>) {
            return critiqueTrace(args as unknown as CriticInput);
          },
        },
      ],
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: "You are a bounded harness critic. Always use trace.critic before proposing a patch.",
        model: faux.getModel(),
        tools,
        messages: [],
      },
    });

    agent.subscribe((event) => {
      modelEvents.push(event.type);
    });

    await agent.prompt("Review this research harness trace and propose the next implementation patch.");
    const bounded = critiqueTrace(input);
    return {
      ...bounded,
      modelMode: "faux",
      modelEvents,
      modelEventCount: modelEvents.length,
      pendingResponses: faux.getPendingResponseCount(),
    };
  } finally {
    faux.unregister();
  }
}

function nextFrontier({ ask, queryPlan, sourceDecisions }: FrontierInput): FrontierLead[] {
  const leads: FrontierLead[] = [];
  const seen = new Set(queryPlan.map((query) => query.toLowerCase()));
  for (const source of sourceDecisions) {
    const titleTerms = compactTitle(source.title);
    for (const followUp of source.rank?.followUp ?? []) {
      pushLead({
        query: `${ask} ${titleTerms} ${followUp}`,
        reason: `Follow-up from ${source.title}: ${followUp}`,
        priority: source.rank?.value === "high" ? "high" : "medium",
        sourceUrl: source.url,
      });
    }
    if (source.decision === "saved" && source.sourceType === "government") {
      pushLead({
        query: `${ask} site:gov ${titleTerms} PDF map planning`,
        reason: `Government-like source should be expanded into direct document/map search: ${source.title}`,
        priority: "high",
        sourceUrl: source.url,
      });
    }
    if (source.failure === "failed_to_save_artifact") {
      pushLead({
        query: `${ask} ${titleTerms} alternate source PDF`,
        reason: `Original source could not be preserved strongly enough: ${source.title}`,
        priority: "medium",
        sourceUrl: source.url,
      });
    }
  }
  for (const query of [
    `${ask} filetype:pdf map planning`,
    `${ask} official map planning document`,
    `${ask} local language government planning map`,
  ]) {
    pushLead({ query, reason: "Generic depth expansion after first source pass.", priority: "low" });
  }
  return leads.slice(0, 10);

  function pushLead(lead: FrontierLead) {
    const key = lead.query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    leads.push(lead);
  }
}

function compactTitle(title: string): string {
  return title
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8)
    .join(" ");
}

function inferSourceType(text: string): string {
  if (text.includes(".gov") || text.includes("government") || text.includes("自然资源")) return "government";
  if (text.includes("pdf")) return "document";
  if (text.includes("map") || text.includes("地图")) return "map";
  if (text.includes("wikipedia")) return "encyclopedia";
  return "web";
}

function redactedInput(value: unknown): JsonValue {
  return summarizeToolValue(value);
}

export function summarizeToolValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => summarizeToolValue(item));
  }
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") return null;
  const summary: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 500) {
      summary[key] = `${item.slice(0, 500)}...`;
    } else {
      summary[key] = summarizeToolValue(item);
    }
  }
  return summary;
}
