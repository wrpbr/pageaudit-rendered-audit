import test from "node:test";
import assert from "node:assert/strict";

import { createWorker } from "../src/worker.js";

function env() {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    SANDBOX_API_KEY: "test-key",
  };
}

test("POST /api/compare returns both PageAudit results", async () => {
  const expected = { target: "https://example.com/", http: { score: 20 }, sandbox: { score: 90 } };
  const worker = createWorker({ compare: async () => expected });
  const response = await worker.fetch(new Request("https://demo.test/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  }), env());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("private targets are rejected before browser work starts", async () => {
  let called = false;
  const worker = createWorker({ compare: async () => { called = true; } });
  const response = await worker.fetch(new Request("https://demo.test/api/compare", {
    method: "POST",
    body: JSON.stringify({ url: "http://localhost:3000" }),
  }), env());

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("missing runtime credential fails closed", async () => {
  const worker = createWorker({ compare: async () => assert.fail("must not run") });
  const response = await worker.fetch(new Request("https://demo.test/api/compare", {
    method: "POST",
    body: JSON.stringify({ url: "https://example.com" }),
  }), { ASSETS: env().ASSETS });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Sandbox verification is not configured." });
});

test("health exposes capability without naming the provider", async () => {
  const response = await createWorker().fetch(new Request("https://demo.test/api/health"), env());
  assert.deepEqual(await response.json(), { ok: true, sandbox: true });
});

test("regular PageAudit routes are proxied to the product API", async () => {
  const calls = [];
  const worker = createWorker({
    proxy: async (request) => {
      calls.push(request.url);
      return Response.json({ token: "guest" });
    },
  });
  const response = await worker.fetch(
    new Request("https://demo.test/api/guest?source=preview", { method: "POST" }), env()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://pageaudit.online/api/guest?source=preview"]);
});

test("static assets receive the PageAudit security headers", async () => {
  const response = await createWorker().fetch(new Request("https://demo.test/"), env());
  const csp = response.headers.get("content-security-policy") || "";
  assert.match(csp, /cdn\.jsdelivr\.net/);
  assert.match(csp, /challenges\.cloudflare\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
});
