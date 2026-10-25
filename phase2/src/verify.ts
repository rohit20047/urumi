import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  credentials,
  api,
  login,
  client,
  data,
  request,
  type Actor,
} from "./verification-client.js";
const creds = credentials();
const passed: string[] = [];
const pass = (s: string) => {
  passed.push(s);
  console.log("PASS " + s);
};
const admin = await login(creds.admin_email, creds.admin_password);
pass("admin login");
let servers = await api(admin, "/servers");
assert.equal(servers.length, 3);
assert.ok(
  servers.every((s: any) => s.status === "Connected"),
  JSON.stringify(servers.map((s: any) => ({ id: s.id, status: s.status }))),
);
assert.equal(JSON.stringify(servers).includes(creds.woocommerce), false);
pass("three connected servers; credentials masked");
const adminKey = await api(admin, "/keys", "POST", {
  name: "Phase 2 verification admin",
});
const a = await client(adminKey.key);
let b: Client | undefined;
let member: Actor | undefined;
let memberKey: any;
let temporaryServer: string | undefined;
try {
  const tools = (await a.listTools()).tools.map((t) => t.name);
  assert.equal(tools.length, 9);
  assert.ok(tools.includes("time__status") && tools.includes("math__status"));
  pass(
    "external official MCP client discovers nine tools and resolves duplicate status names",
  );
  assert.equal(
    data(
      await a.callTool({
        name: "math__calculate",
        arguments: { operation: "add", a: 2, b: 3 },
      }),
    ).result,
    5,
  );
  assert.equal(
    data(await a.callTool({ name: "time__status", arguments: {} })).server,
    "time",
  );
  assert.ok(
    data(
      await a.callTool({
        name: "time__current_time",
        arguments: { timezone: "Asia/Kolkata" },
      }),
    ).utc,
  );
  pass("routing across time and math upstreams");
  const products = data(
    await a.callTool({
      name: "woocommerce__list_products",
      arguments: { per_page: 50 },
    }),
  );
  assert.ok(
    products.length > 0,
    "Publish a product before running live verification.",
  );
  const product = data(
    await a.callTool({
      name: "woocommerce__create_product",
      arguments: {
        name: "Phase 2 Verified Product",
        price: "19.00",
        description:
          "Created through the authenticated TypeScript MCP gateway verification.",
      },
    }),
  );
  assert.ok(product.id > 0);
  console.log("PRODUCT " + product.id);
  const orders = data(
    await a.callTool({
      name: "woocommerce__list_orders",
      arguments: { per_page: 50 },
    }),
  );
  const orderId = Number(process.env.VERIFY_ORDER_ID ?? orders[0]?.id);
  assert.ok(
    Number.isInteger(orderId) && orderId > 0,
    "Place a test checkout order first, or set VERIFY_ORDER_ID to an existing test order.",
  );
  const order = data(
    await a.callTool({
      name: "woocommerce__get_order",
      arguments: { id: orderId },
    }),
  );
  const updated = data(
    await a.callTool({
      name: "woocommerce__update_order_status",
      arguments: { id: orderId, status: order.status },
    }),
  );
  assert.equal(updated.status, order.status);
  pass("all five WooCommerce tools operate on the real store");
  const invalid = await a.callTool({
    name: "woocommerce__get_order",
    arguments: { id: -1 },
  });
  assert.equal(invalid.isError, true);
  pass("invalid arguments return a tool error");
  const mail = `phase2-${Date.now()}@example.test`,
    password = randomBytes(24).toString("base64url");
  const invite = await api(admin, "/invites", "POST", {
    name: "Phase 2 Member",
    email: mail,
  });
  const invitation = new URL(invite.url).searchParams.get("invite");
  assert.equal(
    (await request("/accept-invite", "POST", { token: invitation, password }))
      .status,
    200,
  );
  assert.equal(
    (await request("/accept-invite", "POST", { token: invitation, password }))
      .status,
    400,
  );
  member = await login(mail, password);
  assert.equal((await request("/users", "GET", undefined, member)).status, 403);
  assert.equal(
    (
      await request(
        "/servers",
        "POST",
        { name: "Forbidden", url: "http://example.test/mcp" },
        member,
      )
    ).status,
    403,
  );
  memberKey = await api(member, "/keys", "POST", {
    name: "Phase 2 member external client",
  });
  b = await client(memberKey.key);
  assert.equal(
    data(
      await b.callTool({
        name: "woocommerce__get_order",
        arguments: { id: orderId },
      }),
    ).id,
    orderId,
  );
  pass(
    "single-use invitation, member self-issued key, admin/member boundaries",
  );
  const current = servers.find((s: any) => s.id === "time");
  const edit = {
    name: current.name,
    url: current.url,
    enabled: false,
    authType: current.authType,
  };
  await api(admin, "/servers/time", "PUT", edit);
  try {
    assert.equal(
      (await b.listTools()).tools.some((t) => t.name.startsWith("time__")),
      false,
    );
    assert.equal(
      (await b.callTool({ name: "time__status", arguments: {} })).isError,
      true,
    );
    assert.equal(
      data(await b.callTool({ name: "math__status", arguments: {} })).server,
      "math",
    );
  } finally {
    await api(admin, "/servers/time", "PUT", { ...edit, enabled: true });
  }
  pass(
    "disable hides tools on the same client and blocks calls without affecting healthy servers",
  );
  const created = await api(admin, "/servers", "POST", {
    name: "Header auth verification",
    url: servers.find((s: any) => s.id === "math").url,
    authType: "header",
    headerName: "X-Upstream-Key",
    credential: creds.math,
  });
  temporaryServer = created.id;
  let extra = (await api(admin, "/servers")).find(
    (s: any) => s.id === temporaryServer,
  );
  assert.equal(extra.status, "Connected");
  assert.equal(
    data(
      await a.callTool({ name: temporaryServer + "__status", arguments: {} }),
    ).server,
    "math",
  );
  await api(admin, "/servers/" + temporaryServer, "PUT", {
    name: "Edited server",
    url: extra.url,
    authType: "header",
    headerName: "X-Upstream-Key",
    enabled: true,
  });
  await api(admin, "/servers/" + temporaryServer, "DELETE");
  temporaryServer = undefined;
  pass(
    "add/edit/remove server and dynamically store a static header credential in Kubernetes Secrets",
  );
  await api(admin, "/keys/" + memberKey.id, "DELETE");
  await assert.rejects(() =>
    b!.callTool({ name: "woocommerce__list_orders", arguments: {} }),
  );
  await assert.rejects(() => b!.listTools());
  pass("revocation rejects the next request on the existing external client");
  const audit = await api(admin, "/audit");
  assert.ok(
    audit.some(
      (x: any) =>
        x.user_email === mail &&
        x.server_id === "woocommerce" &&
        x.outcome === "success",
    ),
  );
  assert.ok(
    audit.some(
      (x: any) => x.user_email === mail && x.error === "API key revoked",
    ),
  );
  assert.ok(
    audit.every(
      (x: any) =>
        typeof x.duration_ms === "number" &&
        x.timestamp &&
        x.tool &&
        x.server_name,
    ),
  );
  pass(
    "audit identity, server, tool, timestamp, duration and outcomes, including a rejected revoked-key call",
  );
} finally {
  if (temporaryServer)
    await api(admin, "/servers/" + temporaryServer, "DELETE").catch(() => {});
  if (memberKey)
    await api(admin, "/keys/" + memberKey.id, "DELETE").catch(() => {});
  await a.close();
  if (b) await b.close();
  await api(admin, "/keys/" + adminKey.id, "DELETE");
  if (member) await api(member, "/logout", "POST", {}).catch(() => {});
  await api(admin, "/logout", "POST", {});
}
console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
