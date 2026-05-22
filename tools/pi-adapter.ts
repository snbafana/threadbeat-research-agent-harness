import { researchTools, summarizeToolValue, type JsonValue, type ResearchTool, type ToolSchema } from "./research-tools.ts";

export interface PiToolResult {
  content: { type: "text"; text: string }[];
  details: {
    toolCallId: string;
    tool: string;
    output?: JsonValue;
    status?: string;
  };
}

export interface PiTool {
  name: string;
  label: string;
  description: string;
  parameters: ToolSchema;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (partialResult: PiToolResult) => void,
  ): Promise<PiToolResult>;
}

export function createPiTools({
  tools = researchTools,
  runTool,
}: {
  tools?: ResearchTool[];
  runTool?: (name: string, args: Record<string, unknown>, reason: string) => Promise<unknown>;
} = {}): PiTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      const args = params && typeof params === "object" ? params as Record<string, unknown> : {};
      if (signal?.aborted) throw new Error(`aborted before ${tool.name}`);
      onUpdate?.({
        content: [{ type: "text", text: `Running ${tool.name}` }],
        details: { toolCallId, tool: tool.name, status: "running" },
      });
      const output = runTool
        ? await runTool(tool.name, args, `Pi tool call ${toolCallId} invoked ${tool.name}.`)
        : await tool.execute(args);
      const details = {
        toolCallId,
        tool: tool.name,
        output: summarizeToolValue(output),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(details.output, null, 2) }],
        details,
      };
    },
  }));
}
