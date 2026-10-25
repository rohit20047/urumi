import assert from "node:assert/strict";
import {
  linux,
  credentials,
  api,
  login,
  client,
  data,
} from "./verification-client.js";
const kube = (args: string[], input?: string) =>
  linux("kubectl", ["-n", "urumi", ...args], input);
assert.equal(
  linux("kubectl", ["config", "current-context"]).trim(),
  "k3d-urumi-local",
);
const creds = credentials(),
  admin = await login(creds.admin_email, creds.admin_password);
const key = await api(admin, "/keys", "POST", {
    name: "Cluster resilience verification",
  }),
  c = await client(key.key);
const pod = (
  name: string,
  code: string,
  extra: Record<string, unknown> = {},
) => ({
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name, namespace: "urumi" },
  spec: {
    restartPolicy: "Never",
    automountServiceAccountToken: false,
    containers: [
      {
        name: "test",
        image: process.env.VERIFICATION_IMAGE ?? "urumi/phase2:0.2.1",
        imagePullPolicy: "Never",
        command: ["node", "-e", code],
        resources: {
          requests: { cpu: "10m", memory: "32Mi" },
          limits: { cpu: "100m", memory: "128Mi" },
        },
        ...extra,
      },
    ],
  },
});
let slowId: string | undefined;
try {
  const deny = pod(
    "phase2-network-check",
    `fetch('http://urumi-platform-woocommerce:8000/mcp',{method:'POST',headers:{Authorization:'Bearer '+process.env.TEST_TOKEN,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2500)}).then(r=>{console.log('UNEXPECTED_HTTP_'+r.status);process.exit(1)}).catch(e=>{if(e.name!=='TimeoutError'&&!['ECONNREFUSED','ETIMEDOUT'].includes(e.cause?.code))throw e;console.log('NETWORK_POLICY_DENIED');process.exit(0)})`,
    {
      env: [
        {
          name: "TEST_TOKEN",
          valueFrom: {
            secretKeyRef: { name: "urumi-upstream-woocommerce", key: "value" },
          },
        },
      ],
    },
  );
  kube(["apply", "-f", "-"], JSON.stringify(deny));
  kube([
    "wait",
    "--for=jsonpath={.status.phase}=Succeeded",
    "pod/phase2-network-check",
    "--timeout=60s",
  ]);
  assert.ok(
    kube(["logs", "phase2-network-check"]).includes("NETWORK_POLICY_DENIED"),
  );
  console.log(
    "PASS NetworkPolicy blocks a non-gateway Pod even with a valid upstream token",
  );
  // Validate the second boundary independently from the allowed gateway Pod.
  const noAuth = kube([
    "exec",
    "deployment/urumi-platform-gateway",
    "--",
    "node",
    "-e",
    `fetch('http://urumi-platform-woocommerce:8000/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status))`,
  ]);
  assert.equal(noAuth.trim(), "401");
  console.log(
    "PASS upstream rejects unauthenticated calls from an allowed Pod",
  );
  const slow = pod(
    "phase2-slow-upstream",
    `require('node:http').createServer((q,s)=>setTimeout(()=>{s.writeHead(500);s.end('slow')},30000)).listen(8000,'0.0.0.0')`,
    {
      readinessProbe: {
        tcpSocket: { port: 8000 },
        periodSeconds: 1,
      },
    },
  );
  kube(["apply", "-f", "-"], JSON.stringify(slow));
  kube([
    "wait",
    "--for=condition=Ready",
    "pod/phase2-slow-upstream",
    "--timeout=60s",
  ]);
  const ip = JSON.parse(
    kube(["get", "pod", "phase2-slow-upstream", "-o", "json"]),
  ).status.podIP;
  slowId = (
    await api(admin, "/servers", "POST", {
      name: "Slow test fixture",
      url: `http://${ip}:8000/mcp`,
      authType: "none",
    })
  ).id;
  let started = Date.now();
  const views = await api(admin, "/servers");
  assert.equal(views.find((s: any) => s.id === slowId).status, "Unreachable");
  const listingDuration = Date.now() - started;
  assert.ok(
    listingDuration >= 3000 && listingDuration < 9000,
    `slow server listing must exercise the timeout, took ${listingDuration}ms`,
  );
  started = Date.now();
  assert.equal(
    (await c.callTool({ name: slowId + "__status", arguments: {} })).isError,
    true,
  );
  const callDuration = Date.now() - started;
  assert.ok(
    callDuration >= 3000 && callDuration < 9000,
    `slow server call must exercise the timeout, took ${callDuration}ms`,
  );
  assert.equal(
    data(
      await c.callTool({
        name: "math__calculate",
        arguments: { operation: "multiply", a: 6, b: 7 },
      }),
    ).result,
    42,
  );
  console.log(
    `PASS slow upstream times out; listing ${listingDuration}ms, call ${callDuration}ms; healthy calls remain usable`,
  );
  await api(admin, "/servers/" + slowId, "DELETE");
  slowId = undefined;
  // Kill the active upstream, observe replacement, then hold it offline long
  // enough to assert status and isolation deterministically.
  const old = kube([
    "get",
    "pods",
    "-l",
    "app=urumi-platform-time",
    "-o",
    "jsonpath={.items[0].metadata.name}",
  ]);
  kube(["delete", "pod", old, "--wait=true"]);
  kube([
    "rollout",
    "status",
    "deployment/urumi-platform-time",
    "--timeout=90s",
  ]);
  console.log("PASS killed time upstream Pod is replaced by Kubernetes");
  kube(["scale", "deployment/urumi-platform-time", "--replicas=0"]);
  kube([
    "wait",
    "--for=delete",
    "pod",
    "-l",
    "app=urumi-platform-time",
    "--timeout=60s",
  ]);
  try {
    const offline = await api(admin, "/servers");
    assert.equal(
      offline.find((s: any) => s.id === "time").status,
      "Unreachable",
    );
    assert.ok(
      (await c.listTools()).tools.some(
        (t) => t.name === "woocommerce__list_orders",
      ),
    );
    assert.equal(
      (await c.listTools()).tools.some((t) => t.name.startsWith("time__")),
      false,
    );
    assert.equal(
      data(await c.callTool({ name: "math__status", arguments: {} })).server,
      "math",
    );
  } finally {
    kube(["scale", "deployment/urumi-platform-time", "--replicas=1"]);
    kube([
      "rollout",
      "status",
      "deployment/urumi-platform-time",
      "--timeout=90s",
    ]);
  }
  console.log(
    "PASS unavailable upstream is Unreachable; healthy servers stay usable; upstream recovers",
  );
  const count = (await api(admin, "/audit")).length;
  const me = admin.email;
  kube(["rollout", "restart", "deployment/urumi-platform-gateway"]);
  kube([
    "rollout",
    "status",
    "deployment/urumi-platform-gateway",
    "--timeout=90s",
  ]);
  assert.ok((await api(admin, "/audit")).length >= count);
  assert.ok((await api(admin, "/users")).some((u: any) => u.email === me));
  assert.equal(
    data(await c.callTool({ name: "math__status", arguments: {} })).server,
    "math",
  );
  console.log(
    "PASS sessions, API keys, users and audit records persist after gateway Pod replacement",
  );
  const audit = await api(admin, "/audit");
  assert.ok(
    audit.some(
      (a: any) =>
        a.server_name === "Slow test fixture" && a.outcome === "error",
    ),
  );
  console.log("PASS timeout tool call has an attributed error audit record");
} finally {
  kube(["scale", "deployment/urumi-platform-time", "--replicas=1"]);
  if (slowId) await api(admin, "/servers/" + slowId, "DELETE").catch(() => {});
  kube([
    "delete",
    "pod",
    "phase2-network-check",
    "phase2-slow-upstream",
    "--ignore-not-found",
  ]);
  await c.close();
  await api(admin, "/keys/" + key.id, "DELETE").catch(() => {});
  await api(admin, "/logout", "POST", {}).catch(() => {});
}
