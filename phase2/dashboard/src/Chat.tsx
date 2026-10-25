import React, { useEffect, useRef, useState } from "react";

type Call = { name: string; outcome: string; durationMs: number };
type Message = {
  role: "user" | "assistant";
  text: string;
  calls?: Call[];
  error?: string;
};
type Request = (path: string, method?: string, body?: unknown) => Promise<any>;
export function Chat({ request }: { request: Request }) {
  const [status, setStatus] = useState<{
    enabled: boolean;
    model: string;
    timezone: string;
  }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conversation = useRef(crypto.randomUUID());
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    request("/chat/status")
      .then((s) => {
        if (mounted.current) setStatus(s);
      })
      .catch(() => {
        if (mounted.current)
          setError(
            "Chat status is unavailable. Refresh the page to try again.",
          );
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !status?.enabled) return;
    setBusy(true);
    setError("");
    setDraft("");
    setMessages((previous) => [...previous, { role: "user", text: message }]);
    try {
      const reply = await request("/chat", "POST", {
        conversationId: conversation.current,
        requestId: crypto.randomUUID(),
        message,
      });
      if (mounted.current) {
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: reply.text,
            calls: reply.calls,
            error: reply.error,
          },
        ]);
        if (reply.error)
          setError(
            "Start a new chat to continue. Check Activity before repeating a change.",
          );
      }
    } catch (e) {
      if (mounted.current)
        setError(
          `${(e as Error).message} Check Activity before retrying a change.`,
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="chat">
      <div className="section-head">
        <p className="muted">
          Ask about your store or use your team's connected tools.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            conversation.current = crypto.randomUUID();
            setMessages([]);
            setDraft("");
            setError("");
          }}
        >
          New chat
        </button>
      </div>
      <p className="muted">
        {status
          ? `${status.model} · ${status.timezone}`
          : "Connecting to chat…"}
      </p>
      {status && !status.enabled && (
        <p role="alert" className="error">
          Chat is not enabled yet. Ask your administrator to configure Gemini.
        </p>
      )}
      <p className="chat-note">
        Chat can create products and change orders when you ask. Responses and
        tool data are processed by Gemini. Conversations expire after 30 minutes
        of inactivity or a backend restart.
      </p>
      <div
        className="chat-messages"
        aria-label="Conversation"
        aria-live="polite"
        aria-busy={busy}
      >
        {!messages.length && (
          <div className="chat-empty">
            <h2>How can I help?</h2>
            <p>
              Try “What orders came in today?” or “Create a product named Demo
              Mug priced at 199.”
            </p>
            <p>
              For two connected tools: “Get the current time in Asia/Kolkata and
              calculate 12 × 7.”
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`chat-message ${message.role}`} key={index}>
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            {!!message.calls?.length && (
              <ul className="chat-calls" aria-label="Tools called">
                {message.calls.map((call, i) => (
                  <li key={i}>
                    <code>{call.name}</code>
                    <span
                      className={`badge ${call.outcome === "success" ? "connected" : "unreachable"}`}
                    >
                      {call.outcome}
                    </span>
                    <small>{call.durationMs} ms</small>
                  </li>
                ))}
              </ul>
            )}
            <div className={message.error ? "chat-text error" : "chat-text"}>
              {message.text}
            </div>
          </article>
        ))}
        {busy && <p role="status">Working with your connected tools…</p>}
        <div ref={bottom} />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form onSubmit={send} className="chat-compose">
        <label htmlFor="chat-message">Message</label>
        <textarea
          id="chat-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={6000}
          rows={3}
          disabled={busy || !status?.enabled}
          placeholder="Ask your team assistant…"
          required
        />
        <button disabled={busy || !status?.enabled || !draft.trim()}>
          {busy ? "Working…" : "Send message"}
        </button>
      </form>
    </section>
  );
}
