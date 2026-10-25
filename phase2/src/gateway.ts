import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { all, one, run } from "./db.js";
import { secretRequest } from "./secrets.js";
import { textResult } from "./protocol.js";
import { gatewayToolName, resolveGatewayTool } from "./tool-names.js";
export type User = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
};
export type Upstream = {
  id: string;
  name: string;
  url: string;
  enabled: number;
  secret_ref: string | null;
  auth_type: string;
  header_name: string | null;
};
const timeout = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 4000);
async function discoverTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({ cursor }, { timeout });
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (tools.length > 500) throw new Error("Tool limit exceeded");
  } while (cursor);
  return tools;
}
export async function withUpstream<T>(
  s: Upstream,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (s.secret_ref) {
    const value = (await secretRequest("GET", s.secret_ref)) as string;
    headers[s.auth_type === "bearer" ? "Authorization" : s.header_name!] =
      s.auth_type === "bearer" ? `Bearer ${value}` : value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const transport = new StreamableHTTPClientTransport(new URL(s.url), {
    requestInit: { headers },
    fetch: async (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      }),
  });
  const client = new Client({ name: "urumi-gateway", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}
export async function serverViews() {
  return Promise.all(
    (
      all(
        "SELECT * FROM servers ORDER BY CASE WHEN id='woocommerce' THEN 0 ELSE 1 END,id",
      ) as Upstream[]
    ).map(async (s) => {
      const view = {
        id: s.id,
        name: s.name,
        url: s.url,
        enabled: !!s.enabled,
        authType: s.auth_type,
        headerName: s.header_name,
        hasCredential: !!s.secret_ref,
        status: "Disabled",
        tools: [] as (Tool & { gatewayName: string })[],
      };
      if (!s.enabled) return view;
      try {
        view.tools = (await withUpstream(s, discoverTools)).map((tool) => ({
          ...tool,
          gatewayName: gatewayToolName(s.id, tool.name),
        }));
        view.status = "Connected";
      } catch {
        view.status = "Unreachable";
      }
      return view;
    }),
  );
}
export async function aggregatedTools(): Promise<Tool[]> {
  return (await serverViews())
    .filter((s) => s.status === "Connected")
    .flatMap((s) =>
      s.tools.map(({ gatewayName, ...t }) => ({
        ...t,
        name: gatewayName,
        description: `[${s.name}] ${t.description ?? t.name}`,
      })),
    );
}
export async function gatewayCall(
  user: User,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const split = name.indexOf("__");
  const serverId = split > 0 ? name.slice(0, split) : "unknown";
  let tool = split > 0 ? name.slice(split + 2) : name;
  const s = one("SELECT * FROM servers WHERE id=?", serverId) as
    Upstream | undefined;
  let outcome = "error",
    error: string | null = null;
  try {
    if (!s || !s.enabled) {
      error = "Server unavailable or disabled";
      return textResult({ error }, true);
    }
    const result = (await withUpstream(s, async (c) => {
      if (tool.startsWith("h_")) {
        const original = resolveGatewayTool(
          s.id,
          name,
          (await discoverTools(c)).map((t) => t.name),
        );
        if (original === undefined) {
          error = "Tool is no longer available on this server";
          return textResult({ error }, true);
        }
        tool = original;
      }
      return c.callTool({ name: tool, arguments: args }, undefined, {
        timeout,
      });
    })) as CallToolResult;
    outcome = result.isError ? "error" : "success";
    if (result.isError && !error) error = "Upstream tool returned an error";
    return result;
  } catch {
    error = "Upstream unreachable or timed out";
    return textResult({ error }, true);
  } finally {
    run(
      "INSERT INTO audit(user_id,user_email,server_id,server_name,tool,timestamp,duration_ms,outcome,error) VALUES(?,?,?,?,?,?,?,?,?)",
      user.id,
      user.email,
      serverId,
      s?.name ?? serverId,
      tool,
      timestamp,
      Date.now() - started,
      outcome,
      error,
    );
  }
}
