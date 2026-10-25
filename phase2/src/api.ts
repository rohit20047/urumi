import express from "express";
import { z } from "zod";
import { all, one, run } from "./db.js";
import { digest, token, passwordHash, passwordMatches } from "./security.js";
import {
  serverViews,
  gatewayCall,
  aggregatedTools,
  type User,
} from "./gateway.js";
import { ChatEngine, ChatError, generateGemini } from "./chat.js";
import { secretRequest } from "./secrets.js";
export const publicUser = (u: any): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});
export function bearerUser(req: express.Request): User | null {
  const key = req.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!key) return null;
  const u = one(
    "SELECT u.*,k.revoked FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.hash=?",
    digest(key),
  );
  if (u?.revoked) {
    if (req.body?.method === "tools/call") {
      const name = String(req.body?.params?.name ?? "unknown").slice(0, 128),
        split = name.indexOf("__"),
        id = split > 0 ? name.slice(0, split) : "unknown";
      const s = one("SELECT name FROM servers WHERE id=?", id);
      run(
        "INSERT INTO audit(user_id,user_email,server_id,server_name,tool,timestamp,duration_ms,outcome,error) VALUES(?,?,?,?,?,?,?,?,?)",
        u.id,
        u.email,
        id,
        s?.name ?? id,
        split > 0 ? name.slice(split + 2) : name,
        new Date().toISOString(),
        0,
        "error",
        "API key revoked",
      );
    }
    return null;
  }
  return u ? publicUser(u) : null;
}
function sessionUser(req: express.Request): User | null {
  const session = req
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("urumi_session="))
    ?.slice(14);
  if (!session) return null;
  const u = one(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?",
    digest(session),
    Date.now(),
  );
  return u ? publicUser(u) : null;
}
const password = z.string().min(12).max(200);
const email = z
  .string()
  .email()
  .max(200)
  .transform((v) => v.toLowerCase());
const serverSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z
      .string()
      .url()
      .max(500)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, "Use an HTTP(S) endpoint without credentials or query parameters"),
    enabled: z.boolean().default(true),
    authType: z.enum(["none", "bearer", "header"]).default("none"),
    headerName: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)
      .optional(),
    credential: z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => !/[\r\n]/.test(v))
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.authType !== "header" || !!v.headerName,
    "Header name required",
  )
  .refine(
    (v) =>
      v.authType !== "header" ||
      ![
        "host",
        "cookie",
        "content-length",
        "accept",
        "content-type",
        "mcp-session-id",
        "mcp-protocol-version",
      ].includes(v.headerName!.toLowerCase()),
    "Reserved credential header",
  );
export function setupApi(app: express.Express) {
  const chat = new ChatEngine({
    list: aggregatedTools,
    generate: generateGemini,
    call: async (id, name, args) => {
      const user = one("SELECT id,email,name,role FROM users WHERE id=?", id);
      if (!user) throw new ChatError(401, "User no longer exists.");
      return gatewayCall(user, name, args);
    },
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("X-Urumi-Client") !== "dashboard"
    ) {
      res.status(403).json({ error: "Dashboard request header required" });
      return;
    }
    next();
  });
  app.post("/api/login", (req, res) => {
    const data = z
      .object({ email, password: z.string().max(200) })
      .parse(req.body);
    const u = one("SELECT * FROM users WHERE email=?", data.email);
    if (!u || !passwordMatches(data.password, u.password_hash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const s = token();
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      digest(s),
      u.id,
      Date.now() + 8 * 60 * 60 * 1000,
    );
    res
      .cookie("urumi_session", s, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      })
      .json({ ...publicUser(u), gatewayUrl: process.env.MCP_PUBLIC_URL });
  });
  app.post("/api/accept-invite", (req, res) => {
    const data = z
      .object({ token: z.string().min(20), password })
      .parse(req.body);
    const invite = one(
      "SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?",
      digest(data.token),
      Date.now(),
    );
    if (!invite) {
      res.status(400).json({ error: "Invitation expired or already used" });
      return;
    }
    if (one("SELECT id FROM users WHERE email=?", invite.email)) {
      res.status(409).json({ error: "User already exists" });
      return;
    }
    run(
      "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      invite.email,
      invite.name,
      "member",
      passwordHash(data.password),
    );
    run("UPDATE invites SET used=1 WHERE id=?", invite.id);
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    const u = sessionUser(req);
    if (!u) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    res.locals.user = u;
    next();
  });
  app.get("/api/me", (_req, res) =>
    res.json({ ...res.locals.user, gatewayUrl: process.env.MCP_PUBLIC_URL }),
  );
  app.post("/api/logout", (req, res) => {
    const s = req
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("urumi_session="))
      ?.slice(14);
    if (s) run("DELETE FROM sessions WHERE hash=?", digest(s));
    res.clearCookie("urumi_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/servers", async (_req, res) => res.json(await serverViews()));
  app.get("/api/keys", (_req, res) => {
    const u = res.locals.user as User;
    res.json(
      u.role === "admin"
        ? all(
            "SELECT k.id,k.user_id,k.name,k.prefix,k.revoked,k.created,u.email FROM api_keys k JOIN users u ON u.id=k.user_id ORDER BY k.id DESC",
          )
        : all(
            "SELECT id,user_id,name,prefix,revoked,created FROM api_keys WHERE user_id=? ORDER BY id DESC",
            u.id,
          ),
    );
  });
  app.post("/api/keys", (req, res) => {
    const u = res.locals.user as User;
    const d = z
      .object({
        name: z.string().trim().min(1).max(80),
        userId: z.number().int().positive().optional(),
      })
      .parse(req.body);
    const target = d.userId ?? u.id;
    if (
      (target !== u.id && u.role !== "admin") ||
      !one("SELECT id FROM users WHERE id=?", target)
    ) {
      res.status(403).json({ error: "Cannot issue key for this user" });
      return;
    }
    const key = "urumi_" + token();
    const result = run(
      "INSERT INTO api_keys(user_id,name,hash,prefix) VALUES(?,?,?,?)",
      target,
      d.name,
      digest(key),
      key.slice(0, 12),
    );
    res.json({ id: Number(result.lastInsertRowid), key });
  });
  app.delete("/api/keys/:id", (req, res) => {
    const u = res.locals.user as User;
    const k = one("SELECT * FROM api_keys WHERE id=?", String(req.params.id));
    if (!k || (u.role !== "admin" && k.user_id !== u.id)) {
      res.status(403).json({ error: "Cannot revoke this key" });
      return;
    }
    run("UPDATE api_keys SET revoked=1 WHERE id=?", k.id);
    res.json({ ok: true });
  });
  app.post("/api/tools/call", async (req, res) => {
    const d = z
      .object({
        name: z.string().max(128),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(req.body);
    res.json(await gatewayCall(res.locals.user, d.name, d.arguments));
  });
  app.get("/api/chat/status", (_req, res) =>
    res.json({
      enabled:
        process.env.CHAT_ENABLED === "true" &&
        !!process.env.GEMINI_API_KEY?.trim(),
      model: process.env.LLM_MODEL ?? "gemini-3.5-flash-lite",
      timezone: process.env.CHAT_TIMEZONE ?? "Asia/Kolkata",
    }),
  );
  app.post("/api/chat", async (req, res) => {
    if (
      process.env.CHAT_ENABLED !== "true" ||
      !process.env.GEMINI_API_KEY?.trim()
    ) {
      res
        .status(503)
        .json({
          error:
            "Chat is not configured. Ask your administrator to enable Gemini.",
        });
      return;
    }
    const input = z
      .object({
        conversationId: z.string().uuid(),
        requestId: z.string().uuid(),
        message: z.string().trim().min(1).max(6000),
      })
      .strict()
      .parse(req.body);
    const user = res.locals.user as User;
    try {
      res.json(
        await chat.turn(user.id, input, () => sessionUser(req)?.id === user.id),
      );
    } catch (error) {
      if (error instanceof ChatError)
        res.status(error.status).json({ error: error.message });
      else
        res
          .status(500)
          .json({
            error:
              "Chat could not complete. Check Activity before retrying a change.",
          });
    }
  });
  app.use("/api", (req, res, next) => {
    if (res.locals.user.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    next();
  });
  app.get("/api/users", (_req, res) =>
    res.json(all("SELECT id,email,name,role FROM users ORDER BY id")),
  );
  app.get("/api/invites", (_req, res) =>
    res.json(
      all("SELECT id,email,name,expires,used FROM invites ORDER BY id DESC"),
    ),
  );
  app.post("/api/invites", (req, res) => {
    const d = z
      .object({ email, name: z.string().trim().min(1).max(80) })
      .parse(req.body);
    if (one("SELECT id FROM users WHERE email=?", d.email)) {
      res.status(409).json({ error: "User already exists" });
      return;
    }
    const t = token();
    run(
      "INSERT INTO invites(email,name,hash,expires) VALUES(?,?,?,?)",
      d.email,
      d.name,
      digest(t),
      Date.now() + 86400000,
    );
    res.json({
      url: `${process.env.APP_ORIGIN}/?invite=${encodeURIComponent(t)}`,
    });
  });
  app.get("/api/audit", (_req, res) =>
    res.json(all("SELECT * FROM audit ORDER BY id DESC LIMIT 200")),
  );
  const save = async (req: express.Request, res: express.Response) => {
    const d = serverSchema.parse(req.body);
    const id = req.params.id
      ? String(req.params.id)
      : "s-" + digest(token()).slice(0, 12);
    const existing = one("SELECT * FROM servers WHERE id=?", id);
    if (req.params.id && !existing) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const ref = "urumi-upstream-" + id;
    if (d.authType !== "none" && !d.credential && !existing?.secret_ref) {
      res.status(400).json({ error: "Credential required" });
      return;
    }
    if (d.credential && d.authType !== "none")
      await secretRequest("PUT", ref, d.credential);
    const secret =
      d.authType === "none" ? null : d.credential ? ref : existing.secret_ref;
    run(
      "INSERT INTO servers(id,name,url,enabled,secret_ref,auth_type,header_name) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,enabled=excluded.enabled,secret_ref=excluded.secret_ref,auth_type=excluded.auth_type,header_name=excluded.header_name",
      id,
      d.name,
      d.url,
      d.enabled ? 1 : 0,
      secret,
      d.authType,
      d.authType === "header" ? d.headerName! : null,
    );
    res.json({ id });
  };
  app.post("/api/servers", save);
  app.put("/api/servers/:id", save);
  app.delete("/api/servers/:id", (req, res) => {
    run("DELETE FROM servers WHERE id=?", String(req.params.id));
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
}
