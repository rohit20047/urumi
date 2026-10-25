# Final demonstration checklist

The user will record the final video. This guide is the recording outline, not a claim that a video was recorded or submitted.

## Prepare before recording

- Run the documented setup or start the existing `urumi-local` cluster. Confirm all application workloads Ready and three upstreams Connected.
- Sign in as user A in the dashboard. Open a separate browser profile/session for user B, or use B's external MCP key in Inspector/Claude Code/Cursor. Ordinary tabs share cookies.
- Issue B's key privately before screen capture. Avoid recording raw keys, passwords, Secret contents, private files or the migration archive.
- Use fictional checkout/customer data. Explain that the store uses test cash on delivery.

## Show the live flow

1. Briefly show the architecture in `SYSTEM_DESIGN.md`.
2. Show the storefront and dashboard, three upstream cards, tools and role differences.
3. As A, open Chat and ask: “Create a published product named Demo Notebook Two priced at 199.00 INR.” Show the successful tool trace and resulting storefront product.
4. Add that product to cart and complete a manual test checkout. Show the order number and the same order in WooCommerce admin.
5. As A, ask: “What orders came in today in Asia/Kolkata? Include IDs and totals.” Show the Time/WooCommerce traces, answer and matching audit user.
6. As B, connect the named external client with only the gateway URL and B's key. Discover all nine tools and retrieve today's orders.
7. Run one prompt needing two upstreams, e.g. current time from Time plus today's WooCommerce orders, or Time plus a Math calculation. The automated evidence uses a Gemini external agent whose tool transport is the official MCP Inspector CLI; explain that arrangement accurately if using it.
8. Revoke B's key and show their next request rejected. Explain that this revokes one credential, not B's dashboard account.
9. Disable Time. Refresh tool discovery in chat/external client; show Time tools absent while other tools work. Re-enable it.
10. Kill Time's Pod to show replacement, and hold Time offline briefly to demonstrate Unreachable status while healthy tools keep working. Restore one replica and confirm Connected.
11. Show audit identity, server/tool, timestamp, duration and success/error for the two users.

## Kubernetes commands to explain

```bash
kubectl get nodes -o wide
kubectl -n urumi get pods,pvc,svc,ingress,networkpolicy
kubectl -n urumi describe deployment urumi-platform-gateway
kubectl -n urumi describe job urumi-store-bootstrap
helm list -n urumi
```

Explain the namespace, Secret references (not values), volumes, worker scheduling, probes/resources and public versus internal Services. Explain that NetworkPolicy plus independent upstream authentication enforces the gateway boundary.

For the outage segment (restore immediately afterwards):

```bash
kubectl -n urumi delete pod -l app=urumi-platform-time
kubectl -n urumi rollout status deployment/urumi-platform-time --timeout=120s
kubectl -n urumi scale deployment/urumi-platform-time --replicas=0
# Refresh dashboard and run a healthy Math or WooCommerce tool.
kubectl -n urumi scale deployment/urumi-platform-time --replicas=1
kubectl -n urumi rollout status deployment/urumi-platform-time --timeout=120s
```

## Explain internals and production

- Follow a tool call from client through gateway to WooCommerce REST/database and back.
- Explain prefixed/hashed names, independent deadlines and failed upstream isolation.
- Explain user key hashes, upstream Secrets, Gemini Secret, and why client tokens are not forwarded.
- Discuss what a member can do with shared upstream privileges, prompt injection/untrusted servers, other-member effects and residual namespace Secret/SSRF risks from `THREAT_MODEL.md`.
- Explain the Gemini loop, signed response-state preservation, user attribution, tool traces and ephemeral conversation limits.
- Show local versus production values for DNS, TLS, origin/cookies, image registry, storage, Secrets and local callback override. A live VPS deployment is not claimed.
- Explain `helm history`, upgrade and rollback, and why they do not roll back database/files.

## Submission

Review the repository for credentials, record/upload the video, and submit the repository and video links using the assignment form: https://forms.gle/nftwgyNeenSDmiRb6.

No optional differentiator or multi-store bonus is claimed. Include only tested claims in the recording.
