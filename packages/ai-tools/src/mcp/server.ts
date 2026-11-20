import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { TOOLS, type ToolContext, ToolError } from "../tools";

/**
 * Expone las herramientas del agente por MCP para probarlas con cualquier cliente (Claude
 * Desktop, el inspector de MCP). Solo para desarrollo: usa los datos que se le pasen.
 */
export function createMcpServer(ctx: () => ToolContext): McpServer {
  const server = new McpServer({ name: "lukas-ai-tools", version: "0.1.0" });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as z.ZodObject,
        annotations: { readOnlyHint: true, title: tool.name },
      },
      async (input: unknown) => {
        try {
          const parsed = tool.input.parse(input ?? {});
          const result = await tool.run(ctx(), parsed);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          const message = e instanceof ToolError ? `${e.code}: ${e.message}` : String(e);
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      },
    );
  }
  return server;
}
