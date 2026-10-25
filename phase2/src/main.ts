import express from "express";
import { z } from "zod";
import { serveMcp } from "./protocol.js";
import { callWoo, wooTools } from "./woo.js";
import { callUtility, utilityTools } from "./utilities.js";
import { equalSecret } from "./security.js";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
const role = process.env.APP_ROLE ?? "gateway";
app.get("/healthz", (_req, res) => res.json({ ok: true, role }));
app.get("/readyz", (_req, res) => res.json({ ok: true, role }));
if (role === "gateway") {
  const { seed } = await import("./db.js");
  seed();
  const { setupApi, bearerUser } = await import("./api.js");
  const { aggregatedTools, gatewayCall } = await import("./gateway.js");
  setupApi(app);
  serveMcp(
    app,
    (req) => {
      const user = bearerUser(req);
      return user ? (name, args) => gatewayCall(user, name, args) : null;
    },
    aggregatedTools,
  );
} else {
  if (!process.env.UPSTREAM_TOKEN) throw new Error("UPSTREAM_TOKEN required");
  serveMcp(
    app,
    (req) => {
      const received =
        role === "math"
          ? req.get("X-Upstream-Key")
          : req.get("authorization")?.replace(/^Bearer /i, "");
      if (!received || !equalSecret(received, process.env.UPSTREAM_TOKEN!))
        return null;
      return role === "woocommerce"
        ? callWoo
        : (name, args) => callUtility(role, name, args);
    },
    async () => (role === "woocommerce" ? wooTools : utilityTools(role)),
  );
}
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    res
      .status(err instanceof z.ZodError ? 400 : 500)
      .json({
        error:
          err instanceof z.ZodError
            ? "Invalid request fields"
            : "Request could not be completed",
      });
  },
);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(`Urumi ${role} ready`),
);
