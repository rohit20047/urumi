import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { ToolResult } from "./ToolResult";
import { Chat } from "./Chat";
type User = {
  id: number;
  email: string;
  name: string;
  role: string;
  gatewayUrl?: string;
};
type Server = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: string;
  authType: string;
  headerName: string | null;
  hasCredential: boolean;
  tools: {
    name: string;
    gatewayName: string;
    description?: string;
    inputSchema: unknown;
  }[];
};
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Urumi-Client": "dashboard",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("Servers");
  const [servers, setServers] = useState<Server[]>([]),
    [keys, setKeys] = useState<any[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [invites, setInvites] = useState<any[]>([]);
  const [reveal, setReveal] = useState(""),
    [editing, setEditing] = useState<Server | null | undefined>(undefined),
    [selected, setSelected] = useState(""),
    [args, setArgs] = useState("{}"),
    [result, setResult] = useState<unknown>(undefined),
    [busy, setBusy] = useState(false);
  const inviteToken = new URLSearchParams(location.search).get("invite");
  useEffect(() => {
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const refresh = async () => {
    if (!user) return;
    try {
      const [s, k] = await Promise.all([api("/servers"), api("/keys")]);
      setServers(s);
      setKeys(k);
      if (user.role === "admin") {
        const [u, a, i] = await Promise.all([
          api("/users"),
          api("/audit"),
          api("/invites"),
        ]);
        setUsers(u);
        setAudit(a);
        setInvites(i);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, [user]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (
    e: React.FormEvent<HTMLFormElement>,
    fn: (data: FormData) => Promise<void>,
  ) => {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    void perform(async () => {
      await fn(d);
      form.reset();
    });
  };
  if (loading)
    return (
      <main className="auth">
        <p>Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <main className="auth">
        <div className="brand">
          u<span>urumi</span>
        </div>
        <p className="eyebrow">TEAM MCP WORKSPACE</p>
        <h1>{inviteToken ? "Join your team." : "Your tools, connected."}</h1>
        <p className="muted">One workspace for your store, tools and team.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <form
          onSubmit={(e) =>
            submit(e, async (d) => {
              if (inviteToken) {
                await api("/accept-invite", "POST", {
                  token: inviteToken,
                  password: d.get("password"),
                });
                history.replaceState({}, "", "/");
                setNotice("Account created. Sign in with your invited email.");
                return;
              }
              setUser(
                await api("/login", "POST", {
                  email: d.get("email"),
                  password: d.get("password"),
                }),
              );
            })
          }
        >
          {!inviteToken && (
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </label>
          )}
          <label>
            {inviteToken ? "Choose a password (12+ characters)" : "Password"}
            <input
              name="password"
              type="password"
              minLength={inviteToken ? 12 : undefined}
              maxLength={200}
              required
              autoComplete={inviteToken ? "new-password" : "current-password"}
            />
          </label>
          <button disabled={busy}>
            {busy ? "Please wait…" : inviteToken ? "Create account" : "Sign in"}
          </button>
        </form>
      </main>
    );
  const tools = servers
    .filter((s) => s.status === "Connected")
    .flatMap((s) =>
      s.tools.map((t) => ({
        ...t,
        name: t.gatewayName,
        server: s.name,
      })),
    );
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          u<span>urumi</span>
        </div>
        <p className="eyebrow">TEAM WORKSPACE</p>
        <nav>
          {[
            "Servers",
            "API keys",
            "Tools",
            "Chat",
            ...(user.role === "admin" ? ["Team", "Activity"] : []),
          ].map((v) => (
            <button
              className={view === v ? "active" : ""}
              key={v}
              onClick={() => {
                setView(v);
                setError("");
                setNotice("");
              }}
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="profile">
          <strong>{user.name}</strong>
          <small>
            {user.email} · {user.role}
          </small>
          <button
            className="quiet"
            onClick={() =>
              void perform(async () => {
                await api("/logout", "POST", {});
                setUser(null);
                setReveal("");
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">URUMI / {view.toUpperCase()}</p>
            <h1>
              {view === "Servers"
                ? "Your connected tools"
                : view === "API keys"
                  ? "Your gateway access"
                  : view === "Tools"
                    ? "Try a tool"
                    : view === "Chat"
                      ? "Your team assistant"
                      : view === "Team"
                        ? "Build your team"
                        : "Every call, accounted for"}
            </h1>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(refresh)}
          >
            Refresh
          </button>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <div hidden={view !== "Chat"}>
          <Chat key={user.id} request={api} />
        </div>
        {reveal && (
          <section className="reveal">
            <strong>Copy now. This value is shown only once.</strong>
            <pre>{reveal}</pre>
            <button className="secondary" onClick={() => setReveal("")}>
              Close
            </button>
          </section>
        )}
        {view === "Servers" && (
          <>
            <div className="section-head">
              <p className="muted">
                Connect once. Share tools through a single gateway.
              </p>
              {user.role === "admin" && (
                <button onClick={() => setEditing(null)}>Add server</button>
              )}
            </div>
            <div className="cards">
              {servers.map((s) => (
                <article key={s.id}>
                  <div className="section-head">
                    <h2>{s.name}</h2>
                    <span className={"badge " + s.status.toLowerCase()}>
                      {s.status}
                    </span>
                  </div>
                  <p className="endpoint">{s.url}</p>
                  <p className="muted">
                    {s.authType === "none"
                      ? "No credential"
                      : s.authType === "header"
                        ? `Header: ${s.headerName}`
                        : "Bearer credential"}
                    {s.hasCredential ? " · securely stored" : ""}
                  </p>
                  <details>
                    <summary>{s.tools.length} tools</summary>
                    {s.tools.map((t) => (
                      <div className="tool" key={t.name}>
                        <strong>{t.gatewayName}</strong>
                        <p>{t.description}</p>
                      </div>
                    ))}
                  </details>
                  {user.role === "admin" && (
                    <footer>
                      <button
                        className="secondary"
                        onClick={() => setEditing(s)}
                      >
                        Edit
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api("/servers/" + s.id, "PUT", {
                              name: s.name,
                              url: s.url,
                              enabled: !s.enabled,
                              authType: s.authType,
                              ...(s.headerName
                                ? { headerName: s.headerName }
                                : {}),
                            });
                            await refresh();
                          })
                        }
                      >
                        {s.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api("/servers/" + s.id, "DELETE");
                            await refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </footer>
                  )}
                </article>
              ))}
            </div>
            {editing !== undefined && (
              <section className="editor">
                <h2>{editing ? "Edit server" : "Connect a server"}</h2>
                <form
                  key={editing?.id ?? "new"}
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const credential = String(d.get("credential") ?? "");
                      await api(
                        "/servers" + (editing ? "/" + editing.id : ""),
                        editing ? "PUT" : "POST",
                        {
                          name: d.get("name"),
                          url: d.get("url"),
                          enabled: editing?.enabled ?? true,
                          authType: d.get("authType"),
                          ...(d.get("headerName")
                            ? { headerName: d.get("headerName") }
                            : {}),
                          ...(credential ? { credential } : {}),
                        },
                      );
                      setEditing(undefined);
                      await refresh();
                    })
                  }
                >
                  <label>
                    Name
                    <input
                      name="name"
                      defaultValue={editing?.name}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Streamable HTTP URL
                    <input
                      name="url"
                      type="url"
                      defaultValue={editing?.url}
                      placeholder="http://server:8000/mcp"
                      required
                    />
                  </label>
                  <label>
                    Authentication
                    <select
                      name="authType"
                      defaultValue={editing?.authType ?? "none"}
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer token</option>
                      <option value="header">Static header</option>
                    </select>
                  </label>
                  <label>
                    Header name (for static header)
                    <input
                      name="headerName"
                      defaultValue={editing?.headerName ?? ""}
                      placeholder="X-API-Key"
                    />
                  </label>
                  <label>
                    Credential
                    <input
                      name="credential"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        editing?.hasCredential
                          ? "Leave blank to keep current credential"
                          : "Enter token or header value"
                      }
                    />
                  </label>
                  <div className="actions">
                    <button disabled={busy}>Save server</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        )}
        {view === "API keys" && (
          <>
            <section className="panel">
              <p>Use this endpoint with your own API key in an MCP client:</p>
              <code>{user.gatewayUrl ?? location.origin + "/mcp"}</code>
              <p className="muted">
                Send the key as Authorization: Bearer &lt;your key&gt;. Upstream
                credentials are never needed.
              </p>
              <form
                className="inline"
                onSubmit={(e) =>
                  submit(e, async (d) => {
                    const r = await api("/keys", "POST", {
                      name: d.get("name"),
                      ...(d.get("userId")
                        ? { userId: Number(d.get("userId")) }
                        : {}),
                    });
                    setReveal(r.key);
                    await refresh();
                  })
                }
              >
                <label>
                  Key name
                  <input
                    name="name"
                    required
                    placeholder="My MCP client"
                    maxLength={80}
                  />
                </label>
                {user.role === "admin" && (
                  <label>
                    Owner
                    <select name="userId">
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button disabled={busy}>Generate API key</button>
              </form>
            </section>
            <section className="panel">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Owner / prefix</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>
                        {k.email ?? user.email}
                        <small>{k.prefix}…</small>
                      </td>
                      <td>{k.revoked ? "Revoked" : "Active"}</td>
                      <td>
                        {!k.revoked && (
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await api("/keys/" + k.id, "DELETE");
                                await refresh();
                              })
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
        {view === "Tools" && (
          <section className="panel">
            <p className="muted">
              Calls run as {user.email} and are recorded in the audit log.
            </p>
            <label>
              Tool
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setArgs("{}");
                  setResult(undefined);
                }}
              >
                <option value="">Choose a tool</option>
                {tools.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                <p>{tools.find((t) => t.name === selected)?.description}</p>
                <details>
                  <summary>Input schema</summary>
                  <pre>
                    {JSON.stringify(
                      tools.find((t) => t.name === selected)?.inputSchema,
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <label>
                  Arguments (JSON)
                  <textarea
                    rows={7}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setResult(
                        await api("/tools/call", "POST", {
                          name: selected,
                          arguments: JSON.parse(args),
                        }),
                      );
                    })
                  }
                >
                  Run tool
                </button>
              </>
            )}
            {result !== undefined && <ToolResult raw={result} />}
          </section>
        )}
        {view === "Team" && (
          <>
            <section className="panel">
              <h2>Invite a member</h2>
              <p className="muted">
                Create a single-use invitation, valid for 24 hours. Share its
                link privately with your teammate.
              </p>
              <form
                className="inline"
                onSubmit={(e) =>
                  submit(e, async (d) => {
                    const r = await api("/invites", "POST", {
                      name: d.get("name"),
                      email: d.get("email"),
                    });
                    setReveal(r.url);
                    await refresh();
                  })
                }
              >
                <label>
                  Name
                  <input name="name" required />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <button disabled={busy}>Create invitation</button>
              </form>
            </section>
            <section className="panel">
              <h2>Members</h2>
              {users.map((u) => (
                <div className="member" key={u.id}>
                  <strong>{u.name}</strong>
                  <span>{u.email}</span>
                  <span className="badge">{u.role}</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Invitations</h2>
              {invites.map((i) => (
                <div className="member" key={i.id}>
                  <span>{i.email}</span>
                  <span>
                    {i.used
                      ? "Accepted"
                      : i.expires < Date.now()
                        ? "Expired"
                        : "Pending"}
                  </span>
                </div>
              ))}
            </section>
          </>
        )}
        {view === "Activity" && (
          <section className="panel">
            <p className="muted">
              Most recent 200 tool calls. Arguments, results and credentials are
              excluded.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Server / tool</th>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{a.user_email}</td>
                      <td>
                        {a.server_name}
                        <small>{a.tool}</small>
                      </td>
                      <td>{new Date(a.timestamp).toLocaleString()}</td>
                      <td>{a.duration_ms} ms</td>
                      <td>
                        <span
                          className={
                            "badge " +
                            (a.outcome === "success"
                              ? "connected"
                              : "unreachable")
                          }
                        >
                          {a.outcome}
                        </span>
                        {a.error && <small>{a.error}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {audit.length === 0 && (
              <p>No tool calls yet. Try one from Tools or your MCP client.</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
