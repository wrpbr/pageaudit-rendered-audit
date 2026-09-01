import { renderWithSandbox } from "./sandbox-browser.js";
import { comparePageAuditResults } from "./pageaudit/comparison.js";
import { analyzeHtml } from "./pageaudit/lib/audit-analyze.js";
import { fetchAndAudit } from "./pageaudit/lib/audit-fetch.js";
import { normalizeUrl } from "./pageaudit/lib/url-guard.js";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export async function compareUrl({ target, apiKey, fetch: fetcher, render = renderWithSandbox }) {
  const started = Date.now();
  const httpStarted = Date.now();
  const fetched = await fetchAndAudit(target, { fetch: fetcher });
  if (!fetched.ok) {
    throw Object.assign(new Error(fetched.error || "PageAudit could not fetch the URL."), {
      status: fetched.status || 502,
    });
  }

  const http = { ...fetched.result, durationMs: Date.now() - httpStarted };
  const rendered = await render(target, apiKey, fetcher);
  const maximum = 800_000;
  const html = rendered.html.length > maximum ? rendered.html.slice(0, maximum) : rendered.html;
  const sandbox = {
    ...analyzeHtml(html, rendered.url, rendered.status, "text/html", {
      htmlTruncated: rendered.html.length > maximum,
      redirects: http.summary.redirects,
      robotsTxt: http.summary.robotsTxt,
      sitemap: http.summary.sitemap,
    }),
    durationMs: rendered.durationMs,
    consentClicked: Boolean(rendered.consentClicked),
  };

  return {
    target,
    http,
    sandbox,
    changes: comparePageAuditResults(http, sandbox),
    durationMs: Date.now() - started,
  };
}

export function createWorker(dependencies = {}) {
  const compare = dependencies.compare || compareUrl;
  const proxy = dependencies.proxy || proxyPageAudit;
  let active = 0;

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const apiKey = env.SANDBOX_API_KEY;
      if (url.pathname === "/api/health") return json({ ok: true, sandbox: Boolean(apiKey) });

      if (url.pathname === "/api/compare" && request.method === "POST") {
        if (!apiKey) return json({ error: "Sandbox verification is not configured." }, 503);
        if (Number(request.headers.get("content-length")) > 4096) {
          return json({ error: "Request body is too large." }, 413);
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON." }, 400);
        }
        const target = normalizeUrl(body?.url);
        if (!target) return json({ error: "URL must be a public HTTP(S) address." }, 400);
        if (active >= 2) {
          return json({ error: "Two comparisons are already running. Try again shortly." }, 429);
        }

        active += 1;
        try {
          return json(await compare({ target, apiKey, fetch: globalThis.fetch.bind(globalThis) }));
        } catch (error) {
          const status = Number(error?.status) || (/tempo|timeout/i.test(error?.message || "") ? 504 : 502);
          return json({ error: publicMessage(error) }, status);
        } finally {
          active -= 1;
        }
      }

      if (shouldProxy(url.pathname)) return proxy(pageAuditRequest(request));
      const asset = await env.ASSETS.fetch(request);
      return secured(asset);
    },
  };
}

function json(value, status = 200) {
  return secured(Response.json(value, { status, headers: { "Cache-Control": "no-store" } }));
}

function secured(source) {
  const response = new Response(source.body, source);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

function publicMessage(error) {
  const message = String(error?.message || "");
  if (/^(?:Page |The |URL |Unable |Failed |Sandbox |Timed |Too |Invalid )/.test(message)) {
    return message.slice(0, 240);
  }
  return "Unable to complete the comparison.";
}

function shouldProxy(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/") ||
    pathname === "/llms.txt" || pathname === "/llms-full.txt" ||
    pathname === "/openapi.json" || pathname === "/mcp" ||
    pathname === "/ga.js" || pathname === "/tools" ||
    pathname.startsWith("/tools/") || pathname.startsWith("/r/") ||
    pathname.startsWith("/badge/");
}

function pageAuditRequest(request) {
  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, "https://pageaudit.online");
  return new Request(target, request);
}

async function proxyPageAudit(request) {
  const upstream = await fetch(request);
  const response = new Response(upstream.body, upstream);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export default createWorker();
