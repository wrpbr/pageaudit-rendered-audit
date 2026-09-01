/**
 * robots.txt + sitemap.xml da origem do alvo.
 * Fail-soft: 404 ou host recusado não derruba o audit.
 * Sitemap declarado em host privado não é buscado.
 */

import { readCapped } from "./read-capped.js";
import { fetchWithRedirects } from "./redirects.js";

const MAX_ROBOTS = 64 * 1024;
const MAX_SITEMAP = 256 * 1024;
const MAX_SITEMAP_LOCS = 2000;
const SAMPLE_LOCS = 10;
const SITE_TIMEOUT_MS = 8000;
const SITE_MAX_REDIRECTS = 3;

export function parseRobots(text) {
  const src = String(text || "");
  const html = /<!DOCTYPE html|<html[\s>]/i.test(src);
  const sitemaps = [];
  const userAgents = [];
  let ua = "";
  let starDisallowAll = false;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      ua = val.toLowerCase();
      if (ua && !userAgents.includes(ua)) userAgents.push(ua);
    } else if (key === "sitemap" && val) {
      if (sitemaps.length < 20 && !sitemaps.includes(val)) sitemaps.push(val);
    } else if (key === "disallow" && (ua === "*" || ua === "") && val === "/") {
      starDisallowAll = true;
    }
  }
  return { sitemaps, userAgents, disallowAll: starDisallowAll, html };
}

export function parseSitemap(text) {
  const src = String(text || "");
  const html = /<!DOCTYPE html|<html[\s>]/i.test(src);
  if (html) return { kind: null, locCount: 0, locs: [], html: true };
  const kind = /<sitemapindex\b/i.test(src)
    ? "sitemapindex"
    : /<urlset\b/i.test(src)
      ? "urlset"
      : "unknown";
  const locs = [];
  let locCount = 0;
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(src))) {
    locCount++;
    if (locs.length < SAMPLE_LOCS) locs.push(m[1].trim());
    if (locCount >= MAX_SITEMAP_LOCS) break;
  }
  return { kind, locCount, locs, html: false };
}

export async function fetchSiteFiles(pageUrl, opts) {
  const {
    fetch: doFetch = globalThis.fetch.bind(globalThis),
    normalizeUrl,
    headers = {},
  } = opts;
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return {
      robotsTxt: { ok: false, error: "invalid page url" },
      sitemap: { ok: false, error: "invalid page url" },
    };
  }

  const robotsUrl = normalizeUrl(`${origin}/robots.txt`);
  const defaultSitemap = normalizeUrl(`${origin}/sitemap.xml`);
  const signal =
    typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(SITE_TIMEOUT_MS) : undefined;
  const common = { doFetch, normalizeUrl, headers, signal };

  const [robotsTxt, defaultSm] = await Promise.all([
    robotsUrl
      ? fetchOne(robotsUrl, { ...common, kind: "robots" })
      : { url: `${origin}/robots.txt`, ok: false, error: "not allowed" },
    defaultSitemap
      ? fetchOne(defaultSitemap, { ...common, kind: "sitemap" })
      : { url: `${origin}/sitemap.xml`, ok: false, error: "not allowed" },
  ]);

  const declared = (robotsTxt.sitemaps || [])
    .map((u) => {
      try {
        return normalizeUrl(new URL(u, origin).toString());
      } catch {
        return null;
      }
    })
    .find(Boolean);

  let sitemap = defaultSm;
  if (declared && declared !== defaultSitemap) {
    sitemap = await fetchOne(declared, { ...common, kind: "sitemap" });
  }

  return { robotsTxt, sitemap };
}

async function fetchOne(url, { doFetch, normalizeUrl, headers, signal, kind }) {
  const out = {
    url,
    ok: false,
    status: 0,
  };
  try {
    const hop = await fetchWithRedirects(url, {
      fetch: doFetch,
      normalizeUrl,
      maxRedirects: SITE_MAX_REDIRECTS,
      headers,
      signal,
    });
    if (!hop.ok) {
      out.error = hop.error || "fetch failed";
      if (hop.blocked) out.error = "URL is not allowed";
      return out;
    }
    out.status = hop.response.status;
    out.url = hop.finalUrl || url;
    if (out.status >= 400) {
      out.error = `HTTP ${out.status}`;
      await hop.response.body?.cancel?.().catch(() => {});
      return out;
    }
    const text = await readCapped(hop.response, kind === "robots" ? MAX_ROBOTS : MAX_SITEMAP);
    if (kind === "robots") {
      const parsed = parseRobots(text);
      if (parsed.html) {
        out.error = "robots.txt served as HTML";
        return out;
      }
      out.ok = true;
      out.sitemaps = parsed.sitemaps;
      out.disallowAll = parsed.disallowAll;
      out.userAgents = parsed.userAgents;
      return out;
    }
    const parsed = parseSitemap(text);
    if (parsed.html) {
      out.error = "sitemap served as HTML";
      return out;
    }
    out.ok = true;
    out.kind = parsed.kind;
    out.locCount = parsed.locCount;
    out.locs = parsed.locs;
    return out;
  } catch (err) {
    const raw = String(err?.message || err);
    out.error = /internal error; reference/i.test(raw) ? "fetch failed" : raw.slice(0, 200);
    return out;
  }
}
