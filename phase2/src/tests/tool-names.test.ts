import test from "node:test";
import assert from "node:assert/strict";
import { gatewayToolName, resolveGatewayTool } from "../tool-names.js";

test("dotted tools remain discoverable with their original names", () => {
  assert.equal(
    gatewayToolName("time", "admin.tools.list"),
    "time__admin.tools.list",
  );
});
test("128-character upstream names get stable, valid bounded aliases", () => {
  const name = "x".repeat(128);
  const alias = gatewayToolName("s-123456789abc", name);
  assert.ok(alias.length <= 128);
  assert.match(alias, /^[a-zA-Z0-9_.-]+$/);
  assert.equal(alias, gatewayToolName("s-123456789abc", name));
  assert.equal(
    resolveGatewayTool("s-123456789abc", alias, ["plain", name]),
    name,
  );
  assert.equal(
    resolveGatewayTool("s-123456789abc", alias, ["plain"]),
    undefined,
  );
});
test("literal alias-looking names cannot collide with generated aliases", () => {
  const long = "x".repeat(128);
  const alias = gatewayToolName("time", long);
  const literal = alias.slice("time__".length);
  assert.notEqual(gatewayToolName("time", literal), alias);
  assert.notEqual(gatewayToolName("math", long), alias);
  assert.notEqual(gatewayToolName("time", "y".repeat(128)), alias);
});
test("names at the prefix boundary stay unchanged; longer ones are aliased", () => {
  const name = "a".repeat(128 - "time__".length);
  assert.equal(gatewayToolName("time", name), "time__" + name);
  assert.ok(gatewayToolName("time", name + "a").length <= 128);
});
