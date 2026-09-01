import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const required = [
  "dist/index.html",
  "dist/404.html",
  "dist/app.js",
  "dist/rendered-preview.js",
  "dist/sandbox-browser.js",
  "dist/_worker.js",
  "dist/pageaudit/comparison.js",
  "dist/pageaudit/lib/audit-analyze.js",
  "dist/robots.txt",
];

for (const path of required) assert.ok((await stat(path)).isFile(), `${path} is missing`);

const html = await readFile("dist/index.html", "utf8");
const browser = await readFile("dist/rendered-preview.js", "utf8");
const worker = await readFile("dist/_worker.js", "utf8");
const readme = await readFile("README.md", "utf8");

assert.match(html, /name="robots" content="noindex, nofollow"/);
assert.match(html, /Technical SEO page audit/);
assert.match(html, /id="quick-audit-form"/);
assert.match(html, /src="\/rendered-preview\.js"/);
assert.match(browser, /Sandbox verification/);
assert.match(browser, /HTML returned by the server, before page scripts run\./);
assert.match(browser, /Page after scripts run in an isolated browser\./);
assert.doesNotMatch(`${html}\n${browser}`, /Compare with Solari|Without Solari|With Solari/i);
assert.doesNotMatch(`${browser}\n${worker}`, /slr_live_[A-Za-z0-9_-]{8,}/);
assert.match(readme, /https:\/\/pageaudit-rendered\.pages\.dev/);
assert.match(readme, /github\.com\/wrpbr\/pageaudit-rendered-audit/);

process.stdout.write("build contract: ok\n");
