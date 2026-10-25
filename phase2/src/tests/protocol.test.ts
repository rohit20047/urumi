import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serveMcp } from "../protocol.js";
import { utilityTools, callUtility } from "../utilities.js";
test("official SDK initializes, lists and calls real Streamable HTTP tools; invalid arguments fail", async () => {
  const app = express();
  app.use(express.json());
  serveMcp(
    app,
    (req) =>
      req.get("authorization") === "Bearer test-token"
        ? (name, args) => callUtility("math", name, args)
        : null,
    async () => utilityTools("math"),
  );
  const http = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.on("listening", r));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: "test", version: "1" });
  try {
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: "Bearer test-token" } },
      }),
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((t) => t.name),
      ["status", "calculate"],
    );
    const good = await client.callTool({
      name: "calculate",
      arguments: { operation: "add", a: 2, b: 3 },
    });
    assert.equal((good.content as any[])[0].text, '{"result":5}');
    const bad = await client.callTool({
      name: "calculate",
      arguments: { operation: "divide", a: 2, b: 0 },
    });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      http.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
