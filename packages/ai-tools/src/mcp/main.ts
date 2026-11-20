import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sampleData } from "../sample";
import { createMcpServer } from "./server";

// `pnpm --filter @lukas/ai-tools mcp`: servidor MCP por stdio con los datos de ejemplo.
const data = sampleData();
const server = createMcpServer(() => ({ data, now: new Date() }));
await server.connect(new StdioServerTransport());
