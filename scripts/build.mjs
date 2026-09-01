import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");
const output = join(root, "dist");

if (dirname(output) !== root || output === root) {
  throw new Error(`Refusing to replace unsafe build output: ${output}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(source, "public"), output, { recursive: true });
await cp(join(source, "rendered-preview.js"), join(output, "rendered-preview.js"));
await cp(join(source, "sandbox-browser.js"), join(output, "sandbox-browser.js"));
await cp(join(source, "worker.js"), join(output, "_worker.js"));
await cp(join(source, "pageaudit"), join(output, "pageaudit"), { recursive: true });

const indexPath = join(output, "index.html");
const index = (await readFile(indexPath, "utf8"))
  .replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, nofollow">')
  .replace(
    '<script src="/app.js"></script>',
    '<script src="/app.js"></script>\n  <script type="module" src="/rendered-preview.js"></script>'
  );
await writeFile(indexPath, index, "utf8");
await writeFile(join(output, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
await writeFile(join(output, "404.html"), notFoundPage(), "utf8");

function notFoundPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex, nofollow"><title>Page not found — PageAudit</title>
<style>body{font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f7fb;color:#172033}main{max-width:32rem;padding:2rem}a{color:#0d6efd}</style></head>
<body><main><p>HTTP 404</p><h1>Page not found.</h1><a href="/">Back to PageAudit</a></main></body></html>\n`;
}
