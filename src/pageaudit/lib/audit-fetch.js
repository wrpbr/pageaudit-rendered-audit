/**
 * Fetch da URL alvo + redirects + site files; devolve analyzeHtml ou erro.
 */
import { normalizeUrl } from "./url-guard.js";
import { readCapped } from "./read-capped.js";
import { fetchWithRedirects, redirectSummary } from "./redirects.js";
import { fetchSiteFiles } from "./sitefiles.js";
import { analyzeHtml } from "./audit-analyze.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_CHARS = 800_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  "PageAuditBot/0.1 (+https://pageaudit.online)";

/**
 * Fetch a URL and analyze it.
 * Returns { ok: true, result } or { ok: false, status, error, detail }.
 * A failing target is a normal outcome here, not an exception.
 *
 * `opts.fetch` é só para teste: o Worker usa o `fetch` global.
 * Redirects são manuais — cada hop revalida `normalizeUrl` (SECURITY.md §2).
 */
export async function fetchAndAudit(target, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch.bind(globalThis);
  const reqHeaders = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml",
  };
  const signal =
    typeof AbortSignal?.timeout === "function"
      ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
      : undefined;

  const hop = await fetchWithRedirects(target, {
    fetch: doFetch,
    normalizeUrl,
    headers: reqHeaders,
    signal,
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!hop.ok) {
    return {
      ok: false,
      status: hop.status,
      error: hop.error,
      detail: hop.detail || "",
      redirects: redirectSummary(hop.hops, null),
    };
  }

  const res = hop.response;
  const finalUrl = hop.finalUrl || target;
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";
  const headers = pickHeaders(res.headers);
  const redirects = redirectSummary(hop.hops, finalUrl);
  const isHtml = contentType.includes("html") || contentType.includes("xml");

  // Nunca baixar o corpo inteiro só para cortar depois: um alvo hostil responde GB.
  const declared = parseInt(res.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Page is too large to audit",
      detail: `${Math.round(declared / 1024 / 1024)} MB`,
      finalUrl,
      httpStatus: status,
      contentType,
      headers,
      redirects,
    };
  }
  const html = isHtml ? await readCapped(res, MAX_BODY_BYTES) : "";

  if (!html) {
    return {
      ok: false,
      status: 422,
      error: "URL did not return HTML",
      detail: `HTTP ${status} · ${contentType || "unknown content-type"}`,
      finalUrl,
      httpStatus: status,
      contentType,
      headers,
      redirects,
    };
  }

  const site = await fetchSiteFiles(finalUrl, {
    fetch: doFetch,
    normalizeUrl,
    headers: { "User-Agent": USER_AGENT, Accept: "text/plain,application/xml,text/xml,*/*" },
  });

  const truncated = html.length > MAX_HTML_CHARS;
  const slice = truncated ? html.slice(0, MAX_HTML_CHARS) : html;
  return {
    ok: true,
    result: analyzeHtml(slice, finalUrl, status, contentType, {
      headers,
      htmlTruncated: truncated,
      redirects,
      robotsTxt: site.robotsTxt,
      sitemap: site.sitemap,
    }),
  };
}

/**
 * Todos os headers da resposta, menos `set-cookie`.
 *
 * O alvo é um site de terceiro: o `Set-Cookie` dele pode carregar identificador de
 * sessão emitido para o nosso fetch, e guardar isso no D1 é passivo sem contrapartida —
 * nenhuma checagem nossa usa. O resto (HSTS, CSP, X-Frame-Options, cache, server…)
 * vale cada byte: é o que habilita checagem de header de segurança sem novo fetch.
 */
function pickHeaders(h) {
  const out = {};
  for (const [k, v] of h) {
    const key = k.toLowerCase();
    if (key === "set-cookie") continue;
    out[key] = String(v).slice(0, 1024);
  }
  return out;
}
