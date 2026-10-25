import React, { useState } from "react";
import { jsonText, readableResult } from "./result-format";

function JsonNode({
  value,
  label,
  depth = 0,
}: {
  value: unknown;
  label: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null || typeof value !== "object")
    return (
      <div className="json-leaf">
        <span className="json-key">{label}: </span>
        <code>{jsonText(value)}</code>
      </div>
    );
  const entries = Object.entries(value);
  const array = Array.isArray(value);
  return (
    <details
      className="json-node"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="json-key">{label}</span>{" "}
        <span className="muted">
          {array ? `[${entries.length} items]` : `{${entries.length} fields}`}
        </span>
      </summary>
      {open && (
        <div className="json-children">
          {entries.length ? (
            entries.map(([key, item]) => (
              <JsonNode
                key={key}
                value={item}
                label={array ? `[${key}]` : key}
                depth={depth + 1}
              />
            ))
          ) : (
            <code>{array ? "[]" : "{}"}</code>
          )}
        </div>
      )}
    </details>
  );
}

export function ToolResult({ raw }: { raw: unknown }) {
  const [view, setView] = useState("readable");
  const { value, decoded } = readableResult(raw);
  const isError =
    !!raw &&
    typeof raw === "object" &&
    "isError" in raw &&
    raw.isError === true;
  return (
    <section className="tool-result" aria-label="Tool result">
      <h2>
        Tool result{" "}
        <small className={isError ? "result-failed" : "muted"}>
          {isError ? "Tool reported an error" : "Response received"}
        </small>
      </h2>
      <div className="result-switch" role="group" aria-label="Result view">
        {[
          ["readable", "Readable view"],
          ["formatted", "Formatted JSON"],
          ["raw", "Raw JSON"],
        ].map(([id, name]) => (
          <button
            type="button"
            key={id}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="muted">
        {view === "raw"
          ? "Original response, with all fields and text exactly as received by the dashboard."
          : `All response fields are included. ${decoded ? "JSON inside MCP text blocks is decoded for display; other text stays unchanged." : "Plain text, structured data and non-text content are preserved."}`}
      </p>
      {view === "readable" ? (
        <div className="json-tree">
          <JsonNode value={value} label="Response" />
        </div>
      ) : (
        <pre className="result">{jsonText(view === "raw" ? raw : value)}</pre>
      )}
    </section>
  );
}
