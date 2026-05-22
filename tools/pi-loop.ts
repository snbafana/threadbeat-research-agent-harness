import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { createPiTools } from "./pi-adapter.ts";
import type { ResearchTool } from "./research-tools.ts";

export interface PiLoopResult {
  ask: string;
  mode: "faux";
  events: string[];
  eventCount: number;
  pendingResponses: number;
}

export async function runPiLoop({ ask }: { ask: string }): Promise<PiLoopResult> {
  const faux = registerFauxProvider();
  const events: string[] = [];

  try {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("I will expand the query."),
          fauxToolCall("query.expand", { ask }, { id: "tool-call-1" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The query frontier is ready."),
    ]);

    const tools = createPiTools({
      tools: [
        {
          name: "query.expand",
          description: "Expand query for Pi loop smoke.",
          parameters: {
            type: "object",
            required: ["ask"],
            properties: { ask: { type: "string" } },
          },
          async execute(args: Record<string, unknown>) {
            return [`${args.ask} primary sources`, `${args.ask} 国土空间规划 地图 pdf`];
          },
        },
      ] satisfies ResearchTool[],
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: "You are a smoke-test research agent.",
        model: faux.getModel(),
        tools,
        messages: [],
      },
    });

    agent.subscribe((event) => {
      events.push(event.type);
    });

    await agent.prompt("Find primary-source planning map leads.");
    return {
      ask,
      mode: "faux",
      events,
      eventCount: events.length,
      pendingResponses: faux.getPendingResponseCount(),
    };
  } finally {
    faux.unregister();
  }
}
