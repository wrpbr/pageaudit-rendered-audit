import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { analyzeHtml } from "../src/pageaudit/lib/audit-analyze.js";
import { comparePageAuditResults } from "../src/pageaudit/comparison.js";

const shell = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width"><title>Store shell</title>
</head><body><div id="app"></div></body></html>`;

const rendered = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width"><title>Complete product page</title>
  <meta name="description" content="A complete description created after browser hydration.">
  <link rel="canonical" href="https://example.com/product">
</head><body><h1>Complete product page</h1></body></html>`;

test("both HTML sources use the same PageAudit analyzer", () => {
  const http = analyzeHtml(shell, "https://example.com/product", 200, "text/html");
  const sandbox = analyzeHtml(rendered, "https://example.com/product", 200, "text/html");
  const changes = comparePageAuditResults(http, sandbox);

  assert.ok(sandbox.score > http.score);
  assert.deepEqual(http.summary.h1s, []);
  assert.deepEqual(sandbox.summary.h1s, ["Complete product page"]);
  assert.ok(changes.some((change) => change.field === "h1s"));
});

test("the comparison UI explains both sides and reserves room for close buttons", async () => {
  const app = await readFile("src/rendered-preview.js", "utf8");
  const html = await readFile("src/public/index.html", "utf8");

  assert.match(app, /HTML returned by the server, before page scripts run\./);
  assert.match(app, /Page after scripts run in an isolated browser\./);
  assert.match(
    html,
    /\.pa-tab \.nav-link,\s*\.pa-rendered-tab \.nav-link\s*\{[^}]*padding-right:\s*2\.15rem/s
  );
  assert.doesNotMatch(app, /Compare with Solari|Without Solari|With Solari/);
});
