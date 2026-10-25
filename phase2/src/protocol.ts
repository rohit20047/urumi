import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export type ToolCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;
export const textResult = (
  value: unknown,
  isError = false,
): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError,
});
export function serveMcp(
  app: express.Express,
  authorize: (req: Request) => ToolCall | null,
  tools: () => Promise<Tool[]>,
) {
  app.post("/mcp", async (req: Request, res: Response) => {
    const call = authorize(req);
    if (!call) {
      res.status(401).json({ error: "Valid bearer API key required" });
      return;
    }
    const server = new Server(
      { name: "urumi-mcp", version: "0.1.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await tools(),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      call(request.params.name, request.params.arguments ?? {}),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP request failed" });
    }
  });
  app.all("/mcp", (_req, res) => {
    res.status(405).json({ error: "Stateless Streamable HTTP uses POST" });
  });
}
