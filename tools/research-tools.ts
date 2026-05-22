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
  if (!fetched.charCount) {
    return {
      decision: "rejected",
      reason: "Fetched page produced no extracted text, so it cannot be validated or quoted.",
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
