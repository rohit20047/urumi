import test from "node:test";
import assert from "node:assert/strict";
import { readableResult, jsonText } from "../.test-dist/result-format.js";

const text = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError: false,
});
for (const [name, value] of Object.entries({
  products: [
    {
      id: 20,
      name: "Product",
      metadata: { categories: ["A"], dimensions: {} },
    },
  ],
  time: { utc: "2026-10-20T00:00:00Z", timezone: "Asia/Kolkata" },
  math: { result: 42 },
  order: {
    id: 17,
    line_items: [{ name: "Notebook", quantity: 2 }],
    customer: null,
  },
  emptyList: [],
  emptyObject: {},
  null: null,
  boolean: false,
  number: 0,
  string: "ordinary string",
  unicode: {
    日本語: '₹29\nline "two" \\ end',
    html: "<script>alert(1)</script>",
  },
  nestedStrings: {
    postalCode: "00123",
    price: "29.00",
    literal: '{"leave":"as string"}',
    bigId: "9007199254740993",
  },
})) {
  test(`formats ${name}, preserves fields and original response`, () => {
    const raw = text(value),
      original = JSON.stringify(raw);
    const result = readableResult(raw);
    assert.deepEqual(result.value.content[0].text, value);
    assert.equal(result.decoded, 1);
    assert.equal(JSON.stringify(raw), original);
    assert.deepEqual(JSON.parse(jsonText(result.value)), result.value);
  });
}

test("mixed content, structuredContent, metadata and errors all remain available", () => {
  const raw = {
    content: [
      { type: "text", text: '[{"id":1}]', annotations: { priority: 1 } },
      { type: "text", text: "Not JSON\nSecond line" },
      { type: "text", text: "{broken" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "audio", data: "abc", mimeType: "audio/wav" },
      {
        type: "resource",
        resource: { uri: "file:///example", text: "{not a tool text block}" },
      },
      { type: "resource_link", uri: "https://example.test", name: "Reference" },
      null,
      "unexpected block",
    ],
    structuredContent: { nested: { text: "00123" } },
    isError: true,
    _meta: { extra: true },
  };
  const original = JSON.stringify(raw),
    result = readableResult(raw);
  assert.equal(result.decoded, 1);
  assert.deepEqual(result.value.content[0], {
    type: "text",
    text: [{ id: 1 }],
    annotations: { priority: 1 },
  });
  assert.deepEqual(result.value.content.slice(1), raw.content.slice(1));
  assert.deepEqual(result.value.structuredContent, raw.structuredContent);
  assert.equal(result.value.isError, true);
  assert.deepEqual(result.value._meta, raw._meta);
  assert.equal(JSON.stringify(raw), original);
});

test("any top-level JSON shape and unfamiliar envelopes are supported", () => {
  for (const raw of [
    null,
    false,
    0,
    "plain",
    [],
    {},
    { content: null },
    { other: [1, {}] },
  ])
    assert.deepEqual(readableResult(raw), { value: raw, decoded: 0 });
});

test("large lists are complete; prototype-like keys are treated as data", () => {
  const value = Array.from({ length: 500 }, (_, id) => ({
    id,
    nested: { value: id },
  }));
  assert.deepEqual(readableResult(text(value)).value.content[0].text, value);
  const special = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":"data"}',
  );
  assert.deepEqual(
    readableResult(text(special)).value.content[0].text,
    special,
  );
  assert.equal({}.polluted, undefined);
});
