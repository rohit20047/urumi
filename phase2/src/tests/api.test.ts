import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test(
  "dashboard API validates inputs, separates roles, and revokes bearer keys",
  { timeout: 20_000 },
  async () => {
    const temporary = mkdtempSync(join(tmpdir(), "urumi-api-test-"));
    const listener = http.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const password = randomBytes(24).toString("base64url");
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../main.js", import.meta.url))],
      {
        env: {
          ...process.env,
          APP_ROLE: "gateway",
          PORT: String(port),
          APP_ORIGIN: origin,
          ADMIN_EMAIL: "admin@example.test",
          ADMIN_PASSWORD: password,
          DB_PATH: join(temporary, "gateway.sqlite"),
          CHAT_ENABLED: "false",
        },
        stdio: "ignore",
      },
    );
    const exited = once(child, "exit");
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
    ) => {
      const response = await fetch(origin + path, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Urumi-Client": "dashboard",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(3000),
      });
      return {
        status: response.status,
        data: (await response.json()) as any,
        cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      };
    };
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          ready = (await fetch(origin + "/healthz")).ok;
        } catch {
          /* Starting. */
        }
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, "gateway must start with a new private database");
      assert.equal((await request("/api/chat/status")).status, 401);
      const admin = await request("/api/login", "POST", {
        email: "admin@example.test",
        password,
      });
      assert.equal(admin.status, 200);
      assert.ok(admin.cookie);
      assert.equal(
        (
          await request(
            "/api/tools/call",
            "POST",
            {
              name: "math__calculate",
              arguments: [],
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "/api/servers",
            "POST",
            {
              name: "Invalid",
              url: "file:///etc/passwd",
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      const invite = await request(
        "/api/invites",
        "POST",
        {
          name: "Member",
          email: "member@example.test",
        },
        admin.cookie,
      );
      assert.equal(invite.status, 200);
      const token = new URL(invite.data.url).searchParams.get("invite");
      assert.equal(
        (await request("/api/accept-invite", "POST", { token, password }))
          .status,
        200,
      );
      assert.equal(
        (await request("/api/accept-invite", "POST", { token, password }))
          .status,
        400,
      );
      const member = await request("/api/login", "POST", {
        email: "member@example.test",
        password,
      });
      assert.equal(member.status, 200);
      assert.equal(member.data.role, "member");
      assert.equal(
        (await request("/api/users", "GET", undefined, member.cookie)).status,
        403,
      );
      assert.equal(
        (await request("/api/audit", "GET", undefined, member.cookie)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/keys",
            "POST",
            {
              name: "Forbidden",
              userId: admin.data.id,
            },
            member.cookie,
          )
        ).status,
        403,
      );
      const key = await request(
        "/api/keys",
        "POST",
        { name: "Own key" },
        member.cookie,
      );
      assert.equal(key.status, 200);
      const mcp = () =>
        fetch(origin + "/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${key.data.key}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
      assert.equal((await mcp()).status, 200);
      assert.equal(
        (
          await request(
            "/api/keys/" + key.data.id,
            "DELETE",
            undefined,
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await mcp()).status, 401);
      const visible = await request(
        "/api/keys",
        "GET",
        undefined,
        member.cookie,
      );
      assert.ok(visible.data.every((k: any) => k.user_id === member.data.id));
      assert.equal(JSON.stringify(visible.data).includes(key.data.key), false);
      assert.equal(
        (await request("/api/chat/status", "GET", undefined, member.cookie))
          .status,
        200,
      );
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
