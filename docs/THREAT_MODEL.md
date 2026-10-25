# Threat model

## Assets and trust boundaries

Protect store data, dashboard sessions/passwords, gateway keys, upstream credentials, the Gemini key and audit attribution. Team members use dashboard/API-key boundaries; admins can connect shared upstream capabilities. Kubernetes/host administrators and the trusted gateway process can access namespace data and are outside the ordinary-member boundary. The model and upstream tool descriptions/results are untrusted decision/input sources.

## Shared upstream credentials

Members never receive upstream secrets, but can exercise the privileges of enabled shared tools. In this core implementation members can create products and change order status as well as read data. Hiding the credential does not reduce those shared capabilities. Per-tool permissions are optional assignment scope and are not implemented. A member can therefore affect another member's shared store data. Admins control which servers are available to the whole team.

## Authentication and token separation

Passwords use salted scrypt hashes, gateway keys are random 256-bit values stored as SHA-256 hashes, and browser sessions/invitation tokens are stored by hash. Raw gateway keys are shown once. Key ownership and administrator checks are enforced by the API. Session cookies are HttpOnly and SameSite Strict, with Secure enabled for HTTPS production. Browser mutations require the dashboard header and reject foreign origins.

Revoking a gateway key blocks that credential on the next request. It does not suspend the user, terminate their dashboard session or stop them issuing a different key. Account suspension is not implemented. An invalid unrecognized key cannot reliably be assigned to a user; recognized revoked-key tool attempts are attributed.

Client bearer keys are not forwarded upstream: they identify a user to this gateway and are not credentials for other servers. The gateway authenticates using each upstream's own Secret. Only WooCommerce MCP receives the WooCommerce REST credential. Only the gateway receives Gemini's key. Kubernetes Secrets are base64-encoded, not inherently encrypted at rest; use cluster encryption/secret management for stronger production protection.

## Malicious upstreams and model manipulation

Tool descriptions, product descriptions and returned data may contain prompt injection. The chat system instruction treats them as data, forbids revealing credentials and unrelated actions, and requires explicit user requests for mutations. This reduces risk but is not a guarantee that a model cannot be manipulated. Only currently discovered gateway tools can execute; no arbitrary URL fetch, shell execution or credential-reading tool is exposed. Requests always execute as the logged-in user, with bounded steps/time/results and attributed audits. Tool results and assistant text render as escaped React text, not executable HTML.

A malicious server can lie about results, expose data it already has, or trick a member into misusing another enabled shared tool. Review upstreams before enabling them and keep upstream credential privileges narrow. Administrative URL registration is trusted in core scope: comprehensive SSRF protection is not implemented. A compromised gateway's ServiceAccount can get/create/patch namespace Secrets; Kubernetes cannot restrict create to the application's naming prefix. Stronger namespace/secret-broker isolation would narrow this residual risk.

## Member isolation and chat state

The browser cannot choose the user identity for tool calls. Conversation IDs are generated UUIDs and bound to the authenticated owner; cross-user reuse is rejected. Provider history/signatures remain on the backend. Session validity is rechecked before calls. Members cannot use admin endpoints to manage servers, inspect other members' keys or read the audit log. Frontend visibility is backed by server-side checks.

Chat holds a bounded amount of ephemeral history and admits one active request per user. Provider quota exhaustion and many distinct conversations can still degrade availability; comprehensive user rate limits are optional scope. A completed tool call may survive a lost HTTP response; retries are deduplicated within a live conversation, but crash-safe exactly-once mutations are not claimed.

## Hosted model and logging

Gemini receives user messages, available tool schemas and requested tool-result data, potentially including order/customer fields. Do not use real customer data without an appropriate provider/data-handling agreement. Keys and upstream headers are not put in prompts or browser responses. Provider errors return generic status-based messages rather than raw responses. Audit logs omit arguments, results and credentials but retain identity and activity metadata.

## Repository and deployment

Do not commit credentials, database dumps, migration archives, customer exports or local operational state. Ignore rules help prevent accidental additions but do not remove files already committed. If credentials enter Git history, revoke/rotate them and remove the affected history before publishing; remote cached references may require GitHub Support cleanup.

Production requires HTTPS, separate credentials, restricted infrastructure access and consistent backups. Local storage is tied to one worker and is not node-level high availability. Helm rollback does not undo store transactions or file/database migrations.
