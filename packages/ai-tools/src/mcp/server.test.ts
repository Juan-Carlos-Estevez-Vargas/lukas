import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { sampleData } from "../sample";
import { TOOLS } from "../tools";
import { createMcpServer } from "./server";

async function connect() {
  const data = sampleData();
  const server = createMcpServer(() => ({
    data,
    now: new Date("2026-11-05T15:00:00Z"),
    newId: () => "p-1",
  }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "prueba", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

describe("servidor MCP", () => {
  it("publica todas las herramientas con su esquema", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const summary = tools.find((t) => t.name === "month_summary");
    expect(summary?.inputSchema.properties).toHaveProperty("month");
  });

  it("ejecuta herramientas y devuelve los errores como texto", async () => {
    const client = await connect();
    const ok = await client.callTool({ name: "month_summary", arguments: { month: "2026-10" } });
    expect(JSON.parse(text(ok)).net).toEqual({ amount: "3949200.00", currency: "COP" });
    const missing = await client.callTool({
      name: "propose_recategorize",
      arguments: { movementId: "nada", categoryId: "cat-mercado" },
    });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("not_found");
    const bad = await client.callTool({ name: "month_summary", arguments: { month: "octubre" } });
    expect(bad.isError).toBe(true);
  });
});
