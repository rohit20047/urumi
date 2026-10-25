import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  api,
  request,
  login,
  credentials,
  client,
  data,
  linux,
  type Actor,
} from "./verification-client.js";
import { ChatEngine, generateGemini } from "./chat.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

assert.equal(
  linux("kubectl", ["config", "current-context"]).trim(),
  "k3d-urumi-local",
);
const orderId = Number(process.env.PHASE3_ORDER_ID),
  productId = Number(process.env.PHASE3_PRODUCT_ID);
assert.ok(
  orderId > 0 && productId > 0,
  "Set PHASE3_ORDER_ID and PHASE3_PRODUCT_ID after a real browser checkout of a chat-created product.",
);
const inspector = process.env.INSPECTOR_BIN ?? "mcp-inspector";
const creds = credentials(),
  admin = await login(creds.admin_email, creds.admin_password);
const checked: string[] = [];
const pass = (s: string) => {
  checked.push(s);
  console.log("PASS " + s);
};
const chat = async (actor: Actor, message: string) => {
  const reply = await api(actor, "/chat", "POST", {
    conversationId: randomUUID(),
    requestId: randomUUID(),
    message,
  });
  assert.equal(reply.error, undefined, reply.error);
  return reply;
};
let member: Actor | undefined,
  memberKey: any,
  external: Awaited<ReturnType<typeof client>> | undefined;
let timeConfig: any;
try {
  assert.equal((await request("/chat/status")).status, 401);
  assert.equal(
    (await request("/chat", "POST", { message: "hello" })).status,
    401,
  );
  pass("chat endpoints require dashboard authentication");
  const status = await api(admin, "/chat/status");
  assert.equal(status.enabled, true);
  assert.equal(status.model, "gemini-3.5-flash-lite");
  const usersBefore = await api(admin, "/users");
  const privatePath = join(homedir(), ".config/urumi/phase3-demo.json");
  let demo: { email: string; password: string };
  if (existsSync(privatePath))
    demo = JSON.parse(readFileSync(privatePath, "utf8"));
  else {
    demo = {
      email: `phase3-${Date.now()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    };
    const invite = await api(admin, "/invites", "POST", {
      name: "Phase 3 Member",
      email: demo.email,
    });
    const accepted = await request("/accept-invite", "POST", {
      token: new URL(invite.url).searchParams.get("invite"),
      password: demo.password,
    });
    assert.equal(accepted.status, 200);
    mkdirSync(join(homedir(), ".config/urumi"), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(privatePath, JSON.stringify(demo), { mode: 0o600 });
  }
  member = await login(demo.email, demo.password);
  const memberUser = await api(member, "/me");
  assert.equal(memberUser.role, "member");
  memberKey = await api(member, "/keys", "POST", {
    name: "Phase 3 Inspector verification",
  });
  external = await client(memberKey.key);
  assert.equal((await external.listTools()).tools.length, 9);
  const actual = data(
    await external.callTool({
      name: "woocommerce__get_order",
      arguments: { id: orderId },
    }),
  );
  assert.ok(
    actual.line_items.some((item: any) => item.product_id === productId),
  );
  const today = await chat(
    admin,
    "What orders came in today in Asia/Kolkata? Use current-time and WooCommerce tools, list order IDs and totals.",
  );
  assert.ok(today.calls.some((t: any) => t.name === "time__current_time"));
  assert.ok(
    today.calls.some((t: any) => t.name === "woocommerce__list_orders"),
  );
  assert.ok(
    today.text.includes(String(orderId)),
    "Today's answer must contain the new browser order",
  );
  pass(
    "user A real Gemini chat retrieves today's browser checkout order using timezone-aware tools",
  );

  const inspect = (
    method: string,
    name?: string,
    args?: Record<string, unknown>,
  ) => {
    const arguments_ = [
      "--cli",
      "http://localhost:8080/mcp",
      "--transport",
      "http",
      "--method",
      method,
      "--format",
      "json",
      "--header",
      `Authorization: Bearer ${memberKey.key}`,
    ];
    if (name)
      arguments_.push(
        "--tool-name",
        name,
        "--tool-args-json",
        JSON.stringify(args ?? {}),
      );
    try {
      const output = execFileSync(inspector, arguments_, {
        encoding: "utf8",
        timeout: 45_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const parsed = JSON.parse(output);
      return parsed.result ?? parsed;
    } catch {
      throw new Error(
        "Inspector request failed (details suppressed to protect the bearer key).",
      );
    }
  };
  const listed = inspect("tools/list");
  assert.equal(listed.tools.length, 9);
  const secret = JSON.parse(
    linux("kubectl", [
      "-n",
      "urumi",
      "get",
      "secret",
      "urumi-gemini",
      "-o",
      "json",
    ]),
  );
  process.env.GEMINI_API_KEY = Buffer.from(
    secret.data.GEMINI_API_KEY,
    "base64",
  ).toString();
  // External Gemini agent; every tool request is executed by the named Inspector CLI.
  const agent = new ChatEngine({
    list: async () => inspect("tools/list").tools as Tool[],
    call: async (_user, name, args) => inspect("tools/call", name, args),
    generate: generateGemini,
  });
  const externalAnswer = await agent.turn(
    memberUser.id,
    {
      conversationId: randomUUID(),
      requestId: randomUUID(),
      message:
        "Use the Time server to get the current time in Asia/Kolkata, then use WooCommerce to list today's orders. Include order IDs and totals.",
    },
    () => true,
  );
  assert.equal(externalAnswer.error, undefined, externalAnswer.error);
  assert.ok(externalAnswer.calls.some((c) => c.name === "time__current_time"));
  assert.ok(
    externalAnswer.calls.some((c) => c.name === "woocommerce__list_orders"),
  );
  assert.ok(externalAnswer.text.includes(String(orderId)));
  pass(
    "user B MCP Inspector CLI discovers nine tools; one external Gemini prompt invokes Time and WooCommerce and finds the same order",
  );
  delete process.env.GEMINI_API_KEY;

  const memberChat = await chat(
    member,
    "Use the Math server to calculate 12 multiplied by 7.",
  );
  assert.ok(memberChat.calls.some((c: any) => c.name === "math__calculate"));
  assert.ok(memberChat.text.includes("84"));
  pass("member dashboard chat uses the member identity");
  timeConfig = (await api(admin, "/servers")).find((s: any) => s.id === "time");
  const updateTime = (enabled: boolean) =>
    api(admin, "/servers/time", "PUT", {
      name: timeConfig.name,
      url: timeConfig.url,
      authType: timeConfig.authType,
      enabled,
    });
  await updateTime(false);
  try {
    assert.equal(
      (await external.listTools()).tools.some((t) =>
        t.name.startsWith("time__"),
      ),
      false,
    );
    const disabled = await chat(
      member,
      "Use the Time server to tell me the exact current time in Asia/Kolkata. If no time tool is available, explain that; do not guess.",
    );
    assert.equal(
      disabled.calls.some((c: any) => c.name.startsWith("time__")),
      false,
    );
  } finally {
    await updateTime(true);
  }
  pass(
    "disabled upstream tools disappear from chat discovery and the same external client",
  );
  linux("kubectl", [
    "-n",
    "urumi",
    "scale",
    "deployment/urumi-platform-time",
    "--replicas=0",
  ]);
  try {
    linux("kubectl", [
      "-n",
      "urumi",
      "wait",
      "--for=delete",
      "pod",
      "-l",
      "app=urumi-platform-time",
      "--timeout=90s",
    ]);
    assert.equal(
      (await api(admin, "/servers")).find((s: any) => s.id === "time").status,
      "Unreachable",
    );
    assert.equal(
      (await external.listTools()).tools.some((t) =>
        t.name.startsWith("time__"),
      ),
      false,
    );
    const healthy = await chat(
      member,
      "Use Math to multiply 6 by 7. Do not use Time.",
    );
    assert.ok(healthy.text.includes("42"));
    assert.equal(
      data(
        await external.callTool({
          name: "math__calculate",
          arguments: { operation: "add", a: 2, b: 3 },
        }),
      ).result,
      5,
    );
  } finally {
    linux("kubectl", [
      "-n",
      "urumi",
      "scale",
      "deployment/urumi-platform-time",
      "--replicas=1",
    ]);
    linux("kubectl", [
      "-n",
      "urumi",
      "rollout",
      "status",
      "deployment/urumi-platform-time",
      "--timeout=120s",
    ]);
  }
  pass(
    "offline Time is Unreachable while both member chat and the external client can still use Math",
  );
  await api(admin, "/keys/" + memberKey.id, "DELETE");
  await assert.rejects(() =>
    external!.callTool({ name: "woocommerce__list_orders", arguments: {} }),
  );
  await assert.rejects(() => external!.listTools());
  const afterRevoke = await chat(member, "Use Math to add 1 and 2.");
  assert.ok(afterRevoke.text.includes("3"));
  pass(
    "revoked external key is rejected immediately; the separate member dashboard session still works",
  );

  const audit = await api(admin, "/audit");
  assert.ok(
    audit.some(
      (r: any) =>
        r.user_email === creds.admin_email &&
        r.tool === "create_product" &&
        r.outcome === "success",
    ),
  );
  assert.ok(
    audit.some(
      (r: any) =>
        r.user_email === demo.email &&
        r.tool === "calculate" &&
        r.outcome === "success",
    ),
  );
  assert.ok(
    audit.some(
      (r: any) =>
        r.user_email === demo.email &&
        r.tool === "list_orders" &&
        r.outcome === "success",
    ),
  );
  assert.ok(
    audit.some(
      (r: any) => r.user_email === demo.email && r.error === "API key revoked",
    ),
  );
  assert.ok(
    audit.every(
      (r: any) =>
        r.timestamp &&
        typeof r.duration_ms === "number" &&
        r.server_name &&
        r.tool,
    ),
  );
  assert.ok((await api(admin, "/users")).length >= usersBefore.length);
  pass(
    "chat, Inspector and rejected-key calls are audited under the correct two users",
  );
  console.log(
    JSON.stringify(
      { passed: checked.length, orderId, productId, model: status.model },
      null,
      2,
    ),
  );
} finally {
  if (timeConfig)
    await api(admin, "/servers/time", "PUT", {
      name: timeConfig.name,
      url: timeConfig.url,
      authType: timeConfig.authType,
      enabled: true,
    }).catch(() => {});
  if (memberKey)
    await api(admin, "/keys/" + memberKey.id, "DELETE").catch(() => {});
  await external?.close();
  if (member) await api(member, "/logout", "POST", {}).catch(() => {});
  await api(admin, "/logout", "POST", {}).catch(() => {});
}
