# Configuration and Secrets

The application uses two charts: `helm/urumi-store` and `helm/urumi-platform`. Keep credential values in Kubernetes Secrets, not Helm values, source code or frontend environment variables.

| Secret | Keys | Consumer |
| --- | --- | --- |
| `urumi-store-credentials` | `database-password`, `database-root-password`, `admin-password` | WordPress, MariaDB, store bootstrap |
| `urumi-platform-admin` | `email`, `password` | Initial gateway administrator setup |
| `urumi-woo-rest` | `consumer_key`, `consumer_secret` | WooCommerce MCP only |
| `urumi-upstream-woocommerce` | `value` | Gateway and WooCommerce MCP |
| `urumi-upstream-time` | `value` | Gateway and Time MCP |
| `urumi-upstream-math` | `value` | Gateway and Math MCP (`X-Upstream-Key`) |
| `urumi-gemini` | `GEMINI_API_KEY` | Gateway chat only |
| Production TLS Secrets named in values | `tls.crt`, `tls.key` | Ingress TLS termination |

Admin-managed dynamic upstream credentials use Secrets named `urumi-upstream-<server-id>` with key `value`. Browser/API read-back exposes only presence and authentication type. Changing a user-facing server name does not change its ID. Removing a registration does not automatically remove its Secret.

The local provisioning helpers create matching initial credentials privately. On an initialized database, changing an initial-admin Secret does not reset an existing password. Restoring data requires its matching store/REST/upstream credentials. Kubernetes Secrets are encoded and subject to the cluster's encryption/access configuration; base64 is not encryption.

## Platform values

- `image`, `dashboardImage`, `imagePullPolicy`: local imported images or production registry references.
- `origin`, `mcpUrl`, `ingress.host`, `ingress.tlsSecret`, `cookieSecure`: public addresses and browser session security.
- `storageClass`, `storageSize`: gateway SQLite storage.
- `woo.internalUrl`, `woo.publicUrl`: internal WordPress Service and canonical public store URL.
- `localMcpHost`: loopback alias enabled locally, absent in production.
- `chat.enabled`: enables chat; when true, the gateway requires the Gemini Secret.
- `chat.model`: `gemini-3.5-flash-lite` by default.
- `chat.timezone`: `Asia/Kolkata` by default.
- `chat.existingSecret`: `urumi-gemini` by default.

After updating environment-backed Secrets, restart the affected Deployment, e.g. `kubectl -n urumi rollout restart deployment/urumi-platform-gateway`. No browser reload or Helm value change can refresh an already running container's environment by itself.

## Store values

Store values select the existing credential Secret, image versions, database name/user, storage sizes/class, Ingress hostname/TLS, canonical URL, admin email and bootstrap settings. `wordpress.localLoopback` is a local-only callback fix and stays disabled in production. Store bootstrap is safe to repeat with the existing database; changing plugin/database major versions still requires a deliberate backup/compatibility plan.
