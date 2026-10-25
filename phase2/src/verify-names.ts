import assert from "node:assert/strict";
import {
  credentials,
  api,
  login,
  client,
  linux,
  data,
} from "./verification-client.js";
import { gatewayToolName } from "./tool-names.js";

const kube = (args: string[], input?: string) =>
  linux("kubectl", ["-n", "urumi", ...args], input);
assert.equal(
  linux("kubectl", ["config", "current-context"]).trim(),
  "k3d-urumi-local",
);
const creds = credentials();
const admin = await login(creds.admin_email, creds.admin_password);
const long = "x".repeat(128);
const literalAlias = gatewayToolName("time", long).slice("time__".length);
const names = [
  "plain",
  "admin.tools.list",
  long,
  literalAlias,
  "Mixed.Name-1_ok",
];
const code = `import express from 'express';import {serveMcp,textResult} from './dist/protocol.js';const app=express();app.use(express.json());app.get('/healthz',(_,r)=>r.json({ok:true}));const tools=${JSON.stringify(names)}.map(name=>({name,description:'Tool naming regression fixture',inputSchema:{type:'object',properties:{value:{type:'string'}}}}));serveMcp(app,()=>async(name,args)=>textResult({name,args}),async()=>tools);app.listen(8000,'0.0.0.0');`;
const pod = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "phase2-names-check", namespace: "urumi" },
  spec: {
    restartPolicy: "Never",
    automountServiceAccountToken: false,
    terminationGracePeriodSeconds: 1,
    containers: [
      {
        name: "fixture",
        image: process.env.VERIFICATION_IMAGE ?? "urumi/phase2:0.2.1",
        imagePullPolicy: "Never",
        command: ["node", "--input-type=module", "-e", code],
        readinessProbe: {
          httpGet: { path: "/healthz", port: 8000 },
          periodSeconds: 1,
        },
        resources: {
          requests: { cpu: "10m", memory: "64Mi" },
          limits: { cpu: "200m", memory: "128Mi" },
        },
      },
    ],
  },
};
let id: string | undefined;
let key: any;
let c: Awaited<ReturnType<typeof client>> | undefined;
try {
  kube(["apply", "-f", "-"], JSON.stringify(pod));
  kube([
    "wait",
    "--for=condition=Ready",
    "pod/phase2-names-check",
    "--timeout=60s",
  ]);
  const ip = JSON.parse(
    kube(["get", "pod", "phase2-names-check", "-o", "json"]),
  ).status.podIP;
  id = (
    await api(admin, "/servers", "POST", {
      name: "Naming regression fixture",
      url: `http://${ip}:8000/mcp`,
      authType: "none",
    })
  ).id;
  key = await api(admin, "/keys", "POST", {
    name: "Naming regression verification",
  });
  c = await client(key.key);
  const server = (await api(admin, "/servers")).find((s: any) => s.id === id);
  const tools = (await c.listTools()).tools.filter((t) =>
    t.name.startsWith(id + "__"),
  );
  assert.equal(server.status, "Connected");
  assert.equal(tools.length, names.length);
  assert.equal(new Set(tools.map((t) => t.name)).size, names.length);
  for (const original of names) {
    const name = gatewayToolName(id!, original);
    assert.ok(name.length <= 128);
    assert.ok(tools.some((t) => t.name === name));
    assert.equal(
      server.tools.find((t: any) => t.name === original).gatewayName,
      name,
    );
    const result = data(
      await c.callTool({ name, arguments: { value: "round-trip" } }),
    );
    assert.equal(result.name, original);
    assert.equal(result.args.value, "round-trip");
    const viaDashboard = await api(admin, "/tools/call", "POST", {
      name,
      arguments: { value: "dashboard" },
    });
    assert.equal(data(viaDashboard).name, original);
  }
  console.log(
    "PASS all five tools are discovered and invoked through MCP and dashboard API, including dots, 128-character names and alias-looking names",
  );
  assert.deepEqual(
    (await c.listTools()).tools
      .filter((t) => t.name.startsWith(id + "__"))
      .map((t) => t.name),
    tools.map((t) => t.name),
  );
  console.log(
    "PASS repeated discovery uses stable distinct aliases of at most 128 characters",
  );
  const audit = (await api(admin, "/audit")).filter(
    (a: any) => a.server_id === id,
  );
  assert.ok(
    names.every((original) =>
      audit.some((a: any) => a.tool === original && a.outcome === "success"),
    ),
  );
  console.log("PASS audit records preserve the original upstream tool names");
  await api(admin, "/servers/" + id, "PUT", {
    name: server.name,
    url: server.url,
    authType: "none",
    enabled: false,
  });
  assert.equal(
    (await c.listTools()).tools.some((t) => t.name.startsWith(id + "__")),
    false,
  );
  assert.equal(
    (await c.callTool({ name: gatewayToolName(id!, long), arguments: {} }))
      .isError,
    true,
  );
  console.log("PASS disabling the upstream removes and blocks aliased tools");
} finally {
  if (id) await api(admin, "/servers/" + id, "DELETE");
  if (c) await c.close();
  if (key) await api(admin, "/keys/" + key.id, "DELETE");
  kube(["delete", "pod", "phase2-names-check", "--ignore-not-found"]);
  await api(admin, "/logout", "POST", {});
}
