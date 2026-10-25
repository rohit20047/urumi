import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const windows = process.platform === "win32";
function linux(command: string, args: string[], input?: string) {
  return execFileSync(
    windows ? "wsl" : command,
    windows ? ["-d", "Ubuntu", "--exec", command, ...args] : args,
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}
if (
  linux("kubectl", ["config", "current-context"]).trim() !== "k3d-urumi-local"
)
  throw new Error("Select k3d-urumi-local before local provisioning");
let credentials: Record<string, string>;
try {
  credentials = JSON.parse(
    linux("sh", ["-c", 'cat "$HOME/.config/urumi/phase2-credentials.json"']),
  );
} catch {
  const php = readFileSync(
    new URL("../scripts/create-woo-key.php", import.meta.url),
    "utf8",
  );
  const woo = JSON.parse(
    linux(
      "kubectl",
      [
        "-n",
        "urumi",
        "exec",
        "-i",
        "deployment/urumi-store-wordpress",
        "--",
        "php",
        "/dev/stdin",
      ],
      php,
    ),
  );
  credentials = {
    admin_email: "rohit@example.test",
    admin_password: randomBytes(24).toString("base64url"),
    woocommerce: randomBytes(32).toString("base64url"),
    time: randomBytes(32).toString("base64url"),
    math: randomBytes(32).toString("base64url"),
    ...woo,
  };
  linux(
    "sh",
    [
      "-c",
      'umask 077; mkdir -p "$HOME/.config/urumi"; chmod 700 "$HOME/.config/urumi"; cat > "$HOME/.config/urumi/phase2-credentials.json"; chmod 600 "$HOME/.config/urumi/phase2-credentials.json"',
    ],
    JSON.stringify(credentials, null, 2),
  );
}
const secrets = [
  ...["woocommerce", "time", "math"].map((role) => ({
    name: `urumi-upstream-${role}`,
    data: { value: credentials[role] },
  })),
  {
    name: "urumi-platform-admin",
    data: {
      email: credentials.admin_email,
      password: credentials.admin_password,
    },
  },
  {
    name: "urumi-woo-rest",
    data: {
      consumer_key: credentials.consumer_key,
      consumer_secret: credentials.consumer_secret,
    },
  },
];
for (const s of secrets)
  linux(
    "kubectl",
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: s.name, namespace: "urumi" },
      type: "Opaque",
      data: Object.fromEntries(
        Object.entries(s.data).map(([k, v]) => [
          k,
          Buffer.from(v).toString("base64"),
        ]),
      ),
    }),
  );
console.log(
  "Phase 2 Secrets ready. Credentials retained privately at ~/.config/urumi/phase2-credentials.json; no values printed.",
);
