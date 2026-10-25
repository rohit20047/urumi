import test from "node:test";
import assert from "node:assert/strict";
import {
  passwordHash,
  passwordMatches,
  digest,
  equalSecret,
} from "../security.js";
import { oauthHeader, wooSigningUrl } from "../woo.js";
test("salted passwords verify; wrong passwords and malformed hashes fail", () => {
  const a = passwordHash("a long test password"),
    b = passwordHash("a long test password");
  assert.notEqual(a, b);
  assert.ok(passwordMatches("a long test password", a));
  assert.equal(passwordMatches("wrong", a), false);
  assert.equal(passwordMatches("wrong", "invalid"), false);
  assert.equal(a.includes("a long test password"), false);
});
test("API key digests do not retain the bearer value", () => {
  const raw = "urumi_test_key";
  assert.notEqual(digest(raw), raw);
  assert.equal(digest(raw).length, 64);
  assert.ok(equalSecret(raw, raw));
  assert.equal(equalSecret(raw, raw + "x"), false);
});
test("OAuth requests are individually signed and never contain the consumer secret", () => {
  const url = new URL(
    "http://store.localhost:8080/wp-json/wc/v3/products?per_page=10",
  );
  const a = oauthHeader(url, "GET", "test-consumer", "test-secret"),
    b = oauthHeader(url, "GET", "test-consumer", "test-secret");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("OAuth "));
  assert.ok(a.includes("oauth_signature="));
  assert.equal(a.includes("test-secret"), false);
});
test("production TLS at Ingress signs the scheme observed on the internal WordPress connection", () => {
  const local = wooSigningUrl(
    new URL("http://store.localhost:8080/wp-json/wc/v3/products?page=2"),
    new URL("http://urumi-store-wordpress"),
  );
  assert.equal(
    local.href,
    "http://store.localhost:8080/wp-json/wc/v3/products?page=2",
  );
  const prod = wooSigningUrl(
    new URL("https://store.example.com/wp-json/wc/v3/orders"),
    new URL("http://urumi-store-wordpress"),
  );
  assert.equal(prod.href, "http://store.example.com/wp-json/wc/v3/orders");
});
