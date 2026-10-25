// This is a display projection only. The original tool response remains untouched.
export function readableResult(raw: unknown): {
  value: unknown;
  decoded: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { value: raw, decoded: 0 };
  const envelope = raw as Record<string, unknown>;
  if (!Array.isArray(envelope.content)) return { value: raw, decoded: 0 };
  let decoded = 0;
  const content = envelope.content.map((block: unknown) => {
    if (!block || typeof block !== "object" || Array.isArray(block))
      return block;
    const entry = block as Record<string, unknown>;
    if (entry.type !== "text" || typeof entry.text !== "string") return block;
    try {
      const text: unknown = JSON.parse(entry.text);
      decoded++;
      return { ...entry, text };
    } catch {
      // Plain text and malformed JSON are valid tool output too.
      return block;
    }
  });
  return { value: { ...envelope, content }, decoded };
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "undefined";
}
