import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ChatEngine,
  ChatError,
  modelToolName,
  type Content,
  type ChatDependencies,
} from "../chat.js";
const tool = {
  name: "math__calculate",
  inputSchema: { type: "object" as const, properties: {} },
};
const input = () => ({
  conversationId: randomUUID(),
  requestId: randomUUID(),
  message: "Calculate.",
});
const text = (value: string): Content => ({
  role: "model",
  parts: [{ text: value }],
});
const request = (): Content => ({
  role: "model",
  parts: [
    {
      thoughtSignature: "opaque-signature",
      functionCall: {
        name: modelToolName(tool.name),
        id: "call-1",
        args: { a: 6, b: 7 },
      },
    },
  ],
});
const result = { content: [{ type: "text" as const, text: '{"result":42}' }] };

test("chat preserves Gemini signatures/call IDs, routes as the user, and caches duplicate requests", async () => {
  let generated = 0,
    called = 0;
  const engine = new ChatEngine({
    list: async () => [tool],
    call: async (id, name, args) => {
      assert.equal(id, 7);
      assert.equal(name, tool.name);
      assert.deepEqual(args, { a: 6, b: 7 });
      called++;
      return result;
    },
    generate: async (history) => {
      if (!generated++) return request();
      assert.equal(history[1].parts[0].thoughtSignature, "opaque-signature");
      assert.deepEqual(history[2].parts[0].functionResponse, {
        name: modelToolName(tool.name),
        id: "call-1",
        response: { result },
      });
      return text("42");
    },
  });
  const i = input(),
    reply = await engine.turn(7, i, () => true);
  assert.equal(reply.text, "42");
  assert.equal(reply.calls[0].name, tool.name);
  assert.deepEqual(await engine.turn(7, i, () => true), reply);
  assert.equal(called, 1);
  await assert.rejects(
    engine.turn(7, { ...i, message: "Changed" }, () => true),
    (e: ChatError) => e.status === 409,
  );
  await assert.rejects(
    engine.turn(8, i, () => true),
    (e: ChatError) => e.status === 404,
  );
});

test("disabled tools are absent on the next step and unknown calls never reach the gateway", async () => {
  let listed = 0,
    called = 0;
  const engine = new ChatEngine({
    list: async () => (++listed === 1 ? [tool] : []),
    call: async () => {
      called++;
      return result;
    },
    generate: async (_h, tools) => {
      if (listed === 2) assert.equal(tools.length, 0);
      return request();
    },
  });
  const reply = await engine.turn(1, input(), () => true);
  assert.equal(called, 1);
  assert.equal(reply.calls.length, 1);
  assert.match(reply.error!, /unavailable tool/);
});

test("upstream tool errors are returned to the model and shown as failed traces", async () => {
  let step = 0;
  const engine = new ChatEngine({
    list: async () => [tool],
    call: async () => ({ ...result, isError: true }),
    generate: async (history) => {
      if (!step++) return request();
      assert.equal(
        (history[2].parts[0].functionResponse as any).response.result.isError,
        true,
      );
      return text("The tool failed.");
    },
  });
  const reply = await engine.turn(1, input(), () => true);
  assert.equal(reply.calls[0].outcome, "error");
  assert.equal(reply.text, "The tool failed.");
});

test("expired sessions cannot execute a pending model tool call", async () => {
  let authorized = true,
    calls = 0;
  const engine = new ChatEngine({
    list: async () => [tool],
    call: async () => {
      calls++;
      return result;
    },
    generate: async () => {
      authorized = false;
      return request();
    },
  });
  const reply = await engine.turn(1, input(), () => authorized);
  assert.equal(calls, 0);
  assert.match(reply.error!, /session expired/);
});

test("overlapping turns are rejected and provider failures are cached without replaying tools", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deps: ChatDependencies = {
    list: async () => [tool],
    call: async () => result,
    generate: async () => {
      await waiting;
      throw new Error("Provider unavailable");
    },
  };
  const engine = new ChatEngine(deps),
    i = input();
  const first = engine.turn(1, i, () => true);
  await assert.rejects(
    engine.turn(1, input(), () => true),
    (e: ChatError) => e.status === 409,
  );
  release();
  const reply = await first;
  assert.equal((await engine.turn(1, i, () => true)).error, reply.error);
  await assert.rejects(
    engine.turn(1, { ...i, requestId: randomUUID() }, () => true),
    (e: ChatError) => e.status === 409,
  );
});

test("model tool aliases handle long/dotted names and loops stop at the step limit", async () => {
  const names = ["a".repeat(128), "admin.tools.list", "h_like_alias"];
  assert.equal(new Set(names.map(modelToolName)).size, names.length);
  assert.ok(
    names.map(modelToolName).every((n) => /^[a-zA-Z0-9_]{1,64}$/.test(n)),
  );
  let calls = 0;
  const engine = new ChatEngine({
    list: async () => [tool],
    call: async () => {
      calls++;
      return result;
    },
    generate: async () => request(),
  });
  const reply = await engine.turn(1, input(), () => true);
  assert.equal(calls, 8);
  assert.match(reply.error!, /step limit/);
});
