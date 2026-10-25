# Hands-on test flow for the mandatory assignment

Use this as a rehearsal checklist. It follows the assignment PDF's mandatory scope, including the two-user definition-of-done flow. Optional multi-store, OAuth, per-tool permissions and an actual VPS deployment are excluded. The technical checks at the end complement the browser flow.

Run this against the local test store. It creates fictional products, orders, members and audit records. Use a new product name on each rehearsal. Keep a note of the product ID, order ID and original order status returned in your run; examples below are not fixed IDs.

## 1. Start and prepare

```bash
newgrp docker
sudo systemctl start docker
k3d cluster start urumi-local
cd urumi
kubectl config current-context
kubectl get nodes
kubectl -n urumi get pods,pvc
```

Expected: context `k3d-urumi-local`, two Ready nodes, application Pods `1/1 Running`, three Bound PVCs. The bootstrap Job Pod being Completed is normal. Allow startup time before continuing.

Open these pages:

- User A (admin), normal browser: http://dashboard.localhost:8080/
- User B (member), separate browser profile or private window: the same dashboard URL.
- Storefront: http://store.localhost:8080/
- Store administrator: http://store.localhost:8080/wp-admin/

Ordinary tabs share login cookies, so use separate sessions for A and B. Existing logins are retained privately under `~/.config/urumi/`; do not display credential files or raw keys in a recording. Use fictional checkout details and test Cash on delivery.

## 2. Admin sees the platform

As A, open **Servers** and click **Refresh**.

- [ ] WooCommerce appears first and is Connected, with five tools.
- [ ] Time and Math are Connected, with two tools each.
- [ ] Open the tool lists; there are nine tools in total.
- [ ] `time__status` and `math__status` are distinct even though both upstream names are `status`.
- [ ] Credential presence/type is shown, but the stored credential value is not revealed.

## 3. Invite B and test both ways of issuing keys

As A, open **Team**, invite a fictional member using a new address such as `rehearsal-b-01@example.test`, and copy the invitation URL privately. The application creates a link; it does not send an email.

In B's separate browser session, open the link, set a password of at least 12 characters and sign in. Reopening an accepted invitation should fail.

- [ ] B has the member role and can use Servers, API keys, Tools and Chat.
- [ ] B cannot manage servers and has no Team or Activity administration view. Server-side role rejection is also covered by the scripted core suite below.
- [ ] As A, open **API keys**, select B in **Owner**, and generate `B-admin-issued-test`. This proves admin issuance. Revoke this unused test key afterward.
- [ ] As B, generate an own key named `B-external-rehearsal`. Copy it privately; use this key for the external client below. Do not revoke it until step 10.

## 4. A creates a product through real chat

As A, open **Chat**, choose **New chat**, then send:

> Create a published product named Rehearsal Mug 01 priced at 199.00 INR. Description: Fictional assignment rehearsal product.

- [ ] Trace includes a successful `woocommerce__create_product` call.
- [ ] Record the product ID and product URL from the response. If necessary, use the Tools product-list call in step 7 to obtain the ID.
- [ ] Open the storefront and locate that exact product. Confirm its name and ₹199 price.

Do not repeatedly resend a write if a reply fails. Check Activity or the storefront first; a completed store mutation can outlive a lost response.

## 5. Place the order manually

On the storefront, add that product to cart and proceed to checkout. Use fictional customer details, choose Cash on delivery and place the order.

- [ ] A confirmation page shows an order ID and the correct product, quantity and total.
- [ ] Record the new order ID.
- [ ] In WordPress admin, open **WooCommerce → Orders** and find the same order ID, amount and product. Record its current status.

## 6. A asks about today's orders

In A's chat, send:

> Use Time and WooCommerce to tell me what orders came in today in Asia/Kolkata. Include order IDs, product names and totals.

- [ ] Traces show `time__current_time` and `woocommerce__list_orders`.
- [ ] The answer includes the order you just placed and its correct total.
- [ ] “Today” uses the current Asia/Kolkata date, not a copied date from an earlier run.

## 7. Exercise all five WooCommerce tools explicitly

Open **Tools**. Choose the tool, paste its JSON arguments into **Arguments (JSON)** and click **Run tool**. Replace `123` with your actual new order ID; do not paste `123` literally unless it is your order.

| Tool | Arguments | Expected |
| --- | --- | --- |
| `woocommerce__list_products` | `{"page":1,"per_page":50}` | Your product appears; paginate if necessary. |
| `woocommerce__create_product` | Already tested through A's chat in step 4 | Successful creation plus storefront visibility. |
| `woocommerce__list_orders` | `{"page":1,"per_page":50}` | Your order appears; paginate if necessary. |
| `woocommerce__get_order` | `{"id":123}` | Exact matching order, product and total. |
| `woocommerce__update_order_status` | `{"id":123,"status":"on-hold"}` | Your fictional order changes to On hold in WooCommerce admin. |

Restore the test order to its recorded original status using the same status tool, for example `{"id":123,"status":"processing"}` only if Processing was its original status. Refresh WooCommerce admin to confirm.

Also call `time__status` and `math__status` with `{}`. Their results should identify different servers, proving collision-safe routing. Call Math with `{"operation":"multiply","a":12,"b":7}` and expect 84. An invalid order ID such as `{"id":-1}` should return a tool error without breaking the gateway.

## 8. B uses the external client and dashboard chat

For the simplest natural-language demonstration, use a local Claude Code or Cursor installation with its own working model access. Configure one Streamable HTTP MCP server:

- URL: `http://localhost:8080/mcp`
- Header: `Authorization: Bearer <B's gateway key>`

Use the actual B key privately. Do not configure WooCommerce, Time or Math separately, and do not give the client any upstream credential. A remotely hosted client cannot reach this computer's localhost URL.

- [ ] Fresh tool discovery lists all nine tools from three servers.
- [ ] Ask: “Use Time to get the current time in Asia/Kolkata, then use WooCommerce to list today's orders with IDs and totals.”
- [ ] The same new order is returned. The single prompt invokes both Time and WooCommerce, satisfying the two-upstream requirement.
- [ ] In B's dashboard Chat, ask: “Use Math to multiply 12 by 7.” Confirm a successful trace and 84.

### If using MCP Inspector instead

Inspector is a named client accepted by the PDF. Its protocol UI/CLI can list and call tools, but it does not itself turn a natural-language prompt into model calls. Use the external Gemini/Inspector harness in the scripted checks below for the single-prompt test, or use Claude Code/Cursor for that part. Do not present a manual pair of Inspector calls as a single model prompt.

For Inspector CLI discovery, in a private terminal:

```bash
read -rsp 'Paste B gateway key: ' URUMI_KEY
printf '\n'
npx --yes @modelcontextprotocol/inspector@2.12.0 --cli \
  http://localhost:8080/mcp --transport http --method tools/list \
  --format json --header "Authorization: Bearer $URUMI_KEY"
```

For a real tool call:

```bash
npx --yes @modelcontextprotocol/inspector@2.12.0 --cli \
  http://localhost:8080/mcp --transport http --method tools/call \
  --tool-name woocommerce__list_orders --tool-args-json '{"page":1,"per_page":50}' \
  --format json --header "Authorization: Bearer $URUMI_KEY"
```

This lists recent orders without a today filter. To test today's bounds manually, first call `time__current_time` with `{"timezone":"Asia/Kolkata"}`, then use `woocommerce__list_orders` with actual `after`/`before` timestamps including `+05:30`. The natural-language/harness test performs that reasoning automatically. Keep the terminal variable for revocation testing, then unset it.

## 9. Disable and outage tests while B's key still works

### Disable

As A, disable **Time** in Servers and refresh. In B's external client, rediscover tools. Refresh dashboard Tools and start a new chat.

- [ ] Time says Disabled; its two tools disappear. Seven tools remain.
- [ ] Ask chat to use Time for the exact current time. It should report unavailability without invoking a Time tool. A guessed time is not evidence of a tool call.
- [ ] Math still returns 84 through both chat and the external client.
- [ ] As A, enable Time, refresh, and rediscover nine tools.

### Kill and hold offline

Delete only the Time Pod, then observe its replacement:

```bash
kubectl -n urumi delete pod -l app=urumi-platform-time
kubectl -n urumi rollout status deployment/urumi-platform-time --timeout=120s
```

Kubernetes may replace it too quickly to capture Unreachable in the UI. To hold a visible outage:

```bash
kubectl -n urumi scale deployment/urumi-platform-time --replicas=0
kubectl -n urumi wait --for=delete pod -l app=urumi-platform-time --timeout=120s
```

- [ ] Click dashboard Refresh. Time is Unreachable while still enabled.
- [ ] Fresh discovery excludes Time; Math and WooCommerce continue to work.
- [ ] B's external client and dashboard chat can still call Math.

Restore immediately:

```bash
kubectl -n urumi scale deployment/urumi-platform-time --replicas=1
kubectl -n urumi rollout status deployment/urumi-platform-time --timeout=120s
```

- [ ] Refresh dashboard and external discovery: Time Connected, nine tools again.

## 10. Revoke B's external key

As A, open API keys, locate B's `B-external-rehearsal` key and click **Revoke**. Keep B's external client configured with that same key, then explicitly try another tool call or fresh tool listing.

- [ ] The next gateway request is rejected (unauthorized), even if the client was already initialized.
- [ ] Ensure the client did not silently use another configured key or answer from cached data.
- [ ] B's separate dashboard session can still use chat. This is expected: revoking one API key does not ban the account or invalidate the browser session.

If using the Inspector commands, rerun the tool-call command with the old `$URUMI_KEY` to see rejection, then:

```bash
unset URUMI_KEY
```

## 11. Review every call in Activity

As A, open **Activity** and click **Refresh**. It displays the latest 200 entries.

- [ ] A's product creation and orders calls have A's identity.
- [ ] B's external-client and dashboard-chat tool calls have B's identity.
- [ ] Entries show server, original tool, timestamp, duration and success/error.
- [ ] A known revoked-key tool attempt has an attributed error entry. A rejected tools/list request is not a tool call and does not create this entry.
- [ ] Errors did not erase successful records. Tool discovery itself is not counted as a tool invocation.

## 12. Exercise server registration CRUD

As A, use Servers → Add server to register `Rehearsal temporary` at `http://127.0.0.1:1/mcp`, Authentication None. This deliberately unreachable endpoint is a configuration test only.

- [ ] It saves and shows Unreachable; existing three upstreams still work.
- [ ] Edit its name, then save and confirm persistence.
- [ ] Edit authentication to Bearer token with a fictional value `rehearsal-only-invalid-token`. Save; reopening Edit must not reveal it.
- [ ] Edit authentication to Static header, Header name `X-Rehearsal-Key`, with the same fictional value. Confirm the saved authentication type/header name.
- [ ] Disable it and confirm Disabled, then remove only this temporary registration.

This manual test covers configuration and masking, not successful upstream authentication. The scripted core suite below verifies working header authentication against a real temporary registration. Do not remove or replace the three working seeded registrations or their credentials.

## 13. Technical assignment checks

Inspect names and references without displaying Secret values:

```bash
kubectl get nodes -o wide
kubectl -n urumi get pods,pvc,svc,ingress,networkpolicy
kubectl -n urumi get secrets
kubectl -n urumi describe deployment urumi-platform-gateway
kubectl -n urumi describe deployment urumi-platform-woocommerce
kubectl -n urumi describe deployment urumi-platform-dashboard
kubectl -n urumi describe deployment urumi-platform-time
kubectl -n urumi describe deployment urumi-platform-math
kubectl -n urumi describe deployment urumi-store-wordpress
kubectl -n urumi describe statefulset urumi-store-mariadb
kubectl -n urumi describe job urumi-store-bootstrap
helm list -n urumi
```

- [ ] Store/dashboard have stable Ingress URLs; upstream Services are internal ClusterIP, with gateway-only NetworkPolicies.
- [ ] All workloads have readiness/liveness probes and CPU/memory requests/limits.
- [ ] Database and WordPress content have separate PVCs; gateway data has its own PVC.
- [ ] Secrets are referenced by name/key rather than hardcoded in application source or Helm values. `get secrets` shows metadata, not values; avoid `get secret -o yaml/json` in a recording.
- [ ] Review the design note for custom Streamable HTTP MCP, WooCommerce REST choice, aggregation/routing, name collisions, deadlines and separate upstream credentials.
- [ ] Review the threat model for shared member write privileges, client tokens not forwarded, untrusted tools/prompt injection and member-to-member effects.

To rehearse persistence after Pod replacement, wait for each workload before continuing:

```bash
kubectl -n urumi rollout restart deployment/urumi-store-wordpress
kubectl -n urumi rollout status deployment/urumi-store-wordpress --timeout=180s
kubectl -n urumi rollout restart statefulset/urumi-store-mariadb
kubectl -n urumi rollout status statefulset/urumi-store-mariadb --timeout=180s
kubectl -n urumi rollout restart deployment/urumi-platform-gateway
kubectl -n urumi rollout status deployment/urumi-platform-gateway --timeout=180s
```

Your product, order, users, key revocation and audit history must remain. Check the storefront and admin again. Gateway restart resets ephemeral chat context; start a new chat. Do not delete PVCs or the cluster.

## 14. Scripted checks for things difficult to see manually

Run these sequentially after the manual flow, with all three seeded servers enabled and no temporary registrations. They create additional fictional test data, temporarily disrupt services, and restore their test changes. They do not remove retained fictional products/members/audits. Start no simultaneous manual requests while running resilience checks.

```bash
npm run build --prefix phase2
npm test --prefix phase2
npm test --prefix phase2/dashboard
npm run build --prefix phase2/dashboard
node phase2/dist/verify.js
node phase2/dist/verify-names.js
node phase2/dist/verify-cluster.js
```

Expected: all tests pass. These cover server-side roles, single-use invites, credential masking/header authentication, key revocation, all WooCommerce tools, long/dotted/colliding names, NetworkPolicy with a valid token from an ordinary Pod, upstream authentication, actual slow-server timeouts, healthy-server isolation, Pod replacement and persistent gateway records.

For the real Gemini/two-user/Inspector suite, replace `123` with your new order ID and `456` with your chat-created product ID:

```bash
npm install --prefix /tmp/urumi-inspector --no-audit --no-fund @modelcontextprotocol/inspector@2.12.0
PHASE3_ORDER_ID=123 PHASE3_PRODUCT_ID=456 \
  INSPECTOR_BIN=/tmp/urumi-inspector/node_modules/.bin/mcp-inspector \
  node phase2/dist/verify-phase3.js
```

Run on the same Asia/Kolkata calendar day as your manual checkout because it tests today's orders. It uses real Gemini and can incur API charges. It uses a retained private verification member, not necessarily the manually created B account. Its external Gemini agent executes tool requests through the official Inspector CLI; Inspector receives only gateway URL and that member's gateway key. Eight test groups should pass.

Validate local/production chart configurations:

```bash
helm lint helm/urumi-store -f helm/urumi-store/values-local.yaml
helm lint helm/urumi-store -f helm/urumi-store/values-prod.yaml
helm lint helm/urumi-platform -f helm/urumi-platform/values-local.yaml
helm lint helm/urumi-platform -f helm/urumi-platform/values-prod.yaml
```

Lint is a configuration check, not proof of a live VPS deployment. Explain the same-chart production changes using README, CONFIGURATION and SYSTEM_DESIGN: image registry, DNS, TLS/Ingress, Secure cookies, storage class, new Secrets, backups, upgrades and rollback. Helm rollback does not restore database transactions or WordPress files.

## Finish and submission

- [ ] All three seeded servers are enabled/Connected; nine tools are discoverable.
- [ ] All application Pods are ready, three PVCs Bound; no temporary outage remains.
- [ ] Revoke unused rehearsal keys and remove the temporary registration. Keep fictional test data if needed as evidence.
- [ ] Record the final two-user live flow and explain Kubernetes, MCP internals, security, chat and the local-to-VPS story using `DEMO_GUIDE.md`.
- [ ] Review the source for credentials before publication; keep databases, backups and local operational state private.
- [ ] Submit the video and clean GitHub links through the form in the assignment PDF.

This checklist is a reproducible test plan. Previous mandatory verification results are summarized in README; no final demo recording or live VPS deployment is claimed.
