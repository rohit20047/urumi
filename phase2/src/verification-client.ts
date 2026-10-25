import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const windows = process.platform === "win32";
export const linux = (command: string, args: string[], input?: string) =>
  execFileSync(
    windows ? "wsl" : command,
    windows ? ["-d", "Ubuntu", "--exec", command, ...args] : args,
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
export const credentials = () =>
  JSON.parse(
    linux("sh", ["-c", 'cat "$HOME/.config/urumi/phase2-credentials.json"']),
  );
const base = "http://127.0.0.1:8080",
  host = "dashboard.localhost:8080";
// Preserve Ingress Host without depending on Windows wildcard localhost DNS.
export const localFetch: typeof fetch = async (input, init = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(String(input));
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8080,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: { ...Object.fromEntries(new Headers(init.headers)), host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: Object.fromEntries(
                Object.entries(res.headers)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(",") : String(v),
                  ]),
              ),
            }),
          ),
        );
      },
    );
    const abort = () => req.destroy(new Error("Request aborted"));
    init.signal?.addEventListener("abort", abort, { once: true });
    req.on("close", () => init.signal?.removeEventListener("abort", abort));
    req.on("error", reject);
    req.setTimeout(url.pathname === "/api/chat" ? 110000 : 20000, () =>
      req.destroy(new Error("Verification request timeout")),
    );
    if (init.signal?.aborted) abort();
    else {
      if (init.body) req.write(init.body);
      req.end();
    }
  });
export type Actor = { cookie: string; email: string };
export async function request(
  path: string,
  method = "GET",
  body?: unknown,
  actor?: Actor,
) {
  const r = await localFetch(base + "/api" + path, {
    method,
    headers: {
      Origin: "http://" + host,
      "X-Urumi-Client": "dashboard",
      "Content-Type": "application/json",
      ...(actor ? { Cookie: actor.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/chat" ? 110000 : 20000),
  });
  const text = await r.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { error: text };
  }
  return {
    status: r.status,
    data: value,
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
export async function login(email: string, password: string): Promise<Actor> {
  const r = await request("/login", "POST", { email, password });
  assert.equal(r.status, 200, "login");
  return { cookie: r.cookie, email };
}
export async function api(
  actor: Actor,
  path: string,
  method = "GET",
  body?: unknown,
) {
  let r = await request(path, method, body, actor);
  for (
    let i = 0;
    method === "GET" && [502, 503].includes(r.status) && i < 8;
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    r = await request(path, method, body, actor);
  }
  assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
export async function client(key: string) {
  const c = new Client({
    name: "urumi-external-verification",
    version: "0.1.0",
  });
  await c.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost:8080/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return c;
}
export function data(result: any) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}
