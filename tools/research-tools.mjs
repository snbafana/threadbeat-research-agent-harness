import { webFetch, webSearch } from "./web.mjs";

export const researchTools = [
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
    async execute({ query, limit = 5 }) {
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
    async execute({ url, maxChars = 12000 }) {
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
    async execute({ result, fetched }) {
      return classifySource(result, fetched);
    },
  },
];

export function createToolRunner({ enabledTools, event }) {
  const toolsByName = new Map(researchTools.map((tool) => [tool.name, tool]));
  const enabled = new Set(enabledTools);

  return async function runTool(name, args, reason) {
    if (!enabled.has(name)) throw new Error(`tool is not enabled: ${name}`);
    const tool = toolsByName.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);

    event("tool_started", {
      tool: name,
      input: redactedInput(args),
      reason,
    });
    const output = await tool.execute(args);
    event("tool_completed", {
      tool: name,
      output: summarizeOutput(output),
      reason: `Completed ${name}.`,
    });
    return output;
  };
}

function classifySource(result, fetched) {
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

function inferSourceType(text) {
  if (text.includes(".gov") || text.includes("government") || text.includes("自然资源")) return "government";
  if (text.includes("pdf")) return "document";
  if (text.includes("map") || text.includes("地图")) return "map";
  if (text.includes("wikipedia")) return "encyclopedia";
  return "web";
}

function redactedInput(value) {
  return summarizeOutput(value);
}

function summarizeOutput(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => summarizeOutput(item));
  }
  if (!value || typeof value !== "object") return value;
  const summary = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 500) {
      summary[key] = `${item.slice(0, 500)}...`;
    } else {
      summary[key] = summarizeOutput(item);
    }
  }
  return summary;
}
