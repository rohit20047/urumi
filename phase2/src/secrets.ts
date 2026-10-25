import https from "node:https";
import { readFileSync } from "node:fs";
const root = "/var/run/secrets/kubernetes.io/serviceaccount";
export async function secretRequest(
  method: string,
  name: string,
  value?: string,
): Promise<string | void> {
  if (!/^urumi-upstream-[a-z0-9-]+$/.test(name))
    throw new Error("Invalid upstream Secret reference");
  const ns = process.env.POD_NAMESPACE ?? "urumi";
  const path = `/api/v1/namespaces/${ns}/secrets/${name}`;
  const payload =
    value === undefined
      ? undefined
      : JSON.stringify({
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name,
            namespace: ns,
            labels: { "app.kubernetes.io/part-of": "urumi-phase2" },
          },
          type: "Opaque",
          data: { value: Buffer.from(value).toString("base64") },
        });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: process.env.KUBERNETES_SERVICE_HOST,
        port: Number(process.env.KUBERNETES_SERVICE_PORT ?? 443),
        path,
        method: method === "PUT" ? "PATCH" : method,
        ca: readFileSync(root + "/ca.crt"),
        headers: {
          Authorization: `Bearer ${readFileSync(root + "/token", "utf8")}`,
          ...(payload
            ? { "Content-Type": "application/apply-patch+yaml" }
            : {}),
        },
        ...(method === "PUT"
          ? { path: path + "?fieldManager=urumi-gateway&force=true" }
          : {}),
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 300) {
            reject(new Error("Upstream credential storage unavailable"));
            return;
          }
          if (method === "GET") {
            try {
              resolve(
                Buffer.from(JSON.parse(body).data.value, "base64").toString(),
              );
            } catch {
              reject(new Error("Upstream credential missing"));
            }
          } else resolve();
        });
      },
    );
    req.setTimeout(3000, () =>
      req.destroy(new Error("Secret storage timeout")),
    );
    req.on("error", () =>
      reject(new Error("Upstream credential storage unavailable")),
    );
    if (payload) req.write(payload);
    req.end();
  });
}
