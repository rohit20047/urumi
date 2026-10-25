import { createHash } from "node:crypto";

// Reserve h_ so a literal upstream name cannot impersonate a generated alias.
export function gatewayToolName(
  serverId: string,
  upstreamName: string,
): string {
  if (!/^[a-z0-9-]{1,50}$/.test(serverId)) {
    throw new Error("Invalid server identifier");
  }
  const prefix = `${serverId}__`;
  if (
    /^[a-zA-Z0-9_.-]+$/.test(upstreamName) &&
    !upstreamName.startsWith("h_") &&
    prefix.length + upstreamName.length <= 128
  ) {
    return prefix + upstreamName;
  }
  return (
    prefix + "h_" + createHash("sha256").update(upstreamName).digest("hex")
  );
}

export function resolveGatewayTool(
  serverId: string,
  publicName: string,
  upstreamNames: string[],
): string | undefined {
  return upstreamNames.find(
    (name) => gatewayToolName(serverId, name) === publicName,
  );
}
