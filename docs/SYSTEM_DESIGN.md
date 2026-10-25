# System design and tradeoffs

## Components and request paths

```text
Browser -> Traefik Ingress -> React dashboard
                           -> gateway /api (dashboard sessions)
External MCP client ------> gateway /mcp (per-user bearer keys)
Dashboard chat -> Gemini function-call loop -> gateway discovery/call handlers
Gateway -> WooCommerce MCP -> WooCommerce REST v3 -> WordPress -> MariaDB
        -> Time MCP
        -> Math MCP
```

Everything except the hosted Gemini model runs inside the Kubernetes cluster. The Gemini API key is referenced by Secret only in the gateway Deployment. Chat uses the same `aggregatedTools` and `gatewayCall` handlers as the external MCP endpoint. It has no upstream URL/credential client of its own. The authenticated dashboard user is resolved on the server and rechecked before model-generated tool calls; callers cannot supply a different user identity.

WooCommerce MCP is our TypeScript implementation using the official MCP SDK over stateless Streamable HTTP. It exposes list/create products, list/get orders and update order status. REST v3 provides a documented application interface without executing shell commands in WordPress. A dedicated read/write WooCommerce key signs requests using OAuth 1.0a HMAC-SHA256. The signing URL matches the public hostname and scheme WordPress observes on the internal HTTP connection, including public TLS termination.

The gateway, WooCommerce, Time and Math share one image with different roles; nginx serves the separately built React image. The gateway database is SQLite on a retained PVC. Sessions, users, key hashes, invitations, registrations and audit records survive Pod replacement. One replica and Recreate strategy avoid sharing SQLite between writers. This makes a gateway rollout briefly unavailable; multi-replica operation is not claimed.

## Discovery, routing and failures

Each enabled server is discovered concurrently with a four-second upstream deadline. An unreachable server contributes no tools; others remain available. Every request reads current server configuration, so disabling a server and revoking a key take effect on subsequent requests, including an initialized external client. Clients refresh tool discovery to update their displayed list.

Public names normally use `<server-id>__<tool-name>`. Dots are preserved; names that would exceed 128 characters, contain unsupported characters or start with reserved `h_` get a deterministic full-SHA-256 alias. The alias namespace prevents literal-name collisions. Invocation resolves aliases against current upstream definitions and the audit retains the original upstream tool name. Display-name changes do not change server IDs.

Every actual gateway tool call records the authenticated user, server/tool, UTC timestamp, duration and outcome. Arguments/results and credentials are excluded. Known revoked-key tool attempts are attributed too. A malformed unauthenticated protocol message cannot reliably be attributed to a user.

## Gemini chat

The backend calls Gemini `generateContent` with model `gemini-3.5-flash-lite`. Tool declarations are derived from current gateway discovery; stable `tool_<hash>` aliases fit Gemini's name limits while traces show the original gateway names. Complete model response parts and thought signatures are kept unchanged on the server and matched function-response IDs are returned to Gemini.

The loop is bounded to eight model steps, twelve tool calls, a 90-second overall deadline and 30-second provider request deadlines. Conversations have at most twenty turns and a 250 KB stored-history check. Tool results larger than 60 KB are clearly truncated with a request for narrower pagination. One active turn per user prevents overlapping chat writes. Request IDs cache completed/failed turns to avoid replaying a write after a duplicated HTTP request. Provider requests are not automatically retried.

Conversation history is deliberately ephemeral: server memory, owner-bound UUIDs, a 100-conversation cap and 30-minute idle expiry. It resets on backend restart or browser reload; switching dashboard views preserves the current chat. There is no cross-user conversation read API. Gemini response state is never accepted from the browser. After a partial failure the conversation closes and tells the user to check Activity before retrying a change. This is not exactly-once execution across crashes: a tool could finish before a connection/backend failure, so users must inspect Activity/store state before repeating a mutation.

The system prompt supplies UTC time and the configured team timezone. Today's-order requests obtain current time and use explicit midnight-to-now timezone offsets with WooCommerce `after`/`before`. Gemini receives requested store/tool data; the interface discloses hosted-model processing. It is not given API keys, upstream headers, session cookies or raw gateway bearer keys.

## Kubernetes and storage

Local k3d has one tainted control-plane node and one worker. Ordinary workloads and local-path volumes are on the worker. WordPress content, MariaDB and gateway SQLite have separate PVCs. Pod replacement and cluster stop/start preserve data; deleting the cluster/worker can lose local data. PVC retention annotations are not a backup.

Store and dashboard/MCP routes use Traefik Ingress, stable `.localhost` names and Docker loopback port 8080. Browser `.localhost` resolution needs no external DNS; terminal HTTP clients may use `--resolve`. All upstream MCP Services are internal-only, with gateway-only NetworkPolicies and independent upstream authentication. The finite store bootstrap Job now has startup/readiness/liveness database checks, a completion deadline, retries and resources; it has been executed successfully with the probes.

## Local to VPS

The same Helm charts use production values: registry images, real DNS hostnames, TLS Secrets, HTTPS origins/cookies, the production store URL, a suitable StorageClass/capacity and separately provisioned credentials. The local callback routing override and localhost MCP alias are disabled for production. The VPS needs ingress ports and outbound HTTPS to Gemini. Existing namespace Secret privileges and single-replica SQLite are explicit tradeoffs. A live VPS deployment is optional and has not been performed.

Helm upgrades/rollbacks change manifests, not database contents or persistent files. Take consistent database/file backups before version changes. Test schema/version compatibility before rollback. See README for commands.

## Protocol references

- [Official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling)
- [Gemini thought-signature preservation](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- [Official MCP Inspector CLI](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md)
