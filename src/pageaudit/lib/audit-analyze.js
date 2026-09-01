/**
 * Análise HTML: title/meta/OG/headings/JSON-LD e issues.
 */
import {
  extractImages,
  extractLinks,
  countWords,
  extractHreflang,
  extractLegacy,
} from "./extract.js";

export const MAX_JSONLD_NODES = 50;

export function analyzeHtml(html, finalUrl, status, contentType, extra = {}) {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const lang = attrMatch(html, /<html\b[^>]*\blang=["']([^"']+)["']/i);
  const favicon = faviconOf(html, finalUrl);
  const canonical =
    attrMatch(html, /rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    attrMatch(html, /href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const metaDesc = metaContent(html, "description");
  const robots = metaContent(html, "robots");
  const viewport = metaContent(html, "viewport");
  const charset = charsetOf(html);

  const og = {
    title: metaProp(html, "og:title"),
    description: metaProp(html, "og:description"),
    image: metaProp(html, "og:image"),
    url: metaProp(html, "og:url"),
    type: metaProp(html, "og:type"),
    site_name: metaProp(html, "og:site_name"),
  };

  const twitter = {
    card: metaName(html, "twitter:card"),
    title: metaName(html, "twitter:title"),
    description: metaName(html, "twitter:description"),
    image: metaName(html, "twitter:image"),
  };

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => stripTags(m[1]).trim())
    .filter(Boolean)
    .slice(0, 10);

  const ld = extractJsonLd(html);
  const jsonLd = ld.nodes;
  const images = extractImages(html);
  const links = extractLinks(html, finalUrl);
  const words = countWords(html);
  const hreflang = extractHreflang(html, finalUrl);
  const legacy = extractLegacy(html);
  const redirects = extra.redirects || { hops: [], count: 0, finalUrl };
  const robotsTxt = extra.robotsTxt || null;
  const sitemap = extra.sitemap || null;
  const issues = [];

  if (status >= 400) issues.push(issue("error", "http_status", `HTTP status ${status}`));
  if (!title) issues.push(issue("error", "title_missing", "Missing <title>"));
  else {
    const t = title.trim();
    if (t.length < 15) issues.push(issue("warn", "title_short", `Title is short (${t.length} chars)`));
    if (t.length > 60) issues.push(issue("warn", "title_long", `Title is long (${t.length} chars; aim ≤60)`));
  }

  if (!metaDesc) issues.push(issue("error", "meta_description_missing", "Missing meta description"));
  else if (metaDesc.length < 50) issues.push(issue("warn", "meta_description_short", `Meta description short (${metaDesc.length})`));
  else if (metaDesc.length > 160) issues.push(issue("warn", "meta_description_long", `Meta description long (${metaDesc.length}; aim ≤160)`));

  if (!canonical) issues.push(issue("warn", "canonical_missing", "No rel=canonical"));
  if (!viewport) issues.push(issue("warn", "viewport_missing", "Missing viewport meta"));
  if (!charset) issues.push(issue("info", "charset_missing", "Charset not detected in head"));
  if (!og.title) issues.push(issue("warn", "og_title_missing", "Missing og:title"));
  if (!og.description) issues.push(issue("warn", "og_description_missing", "Missing og:description"));
  if (!og.image) issues.push(issue("warn", "og_image_missing", "Missing og:image"));
  if (!twitter.card) issues.push(issue("info", "twitter_card_missing", "Missing twitter:card"));
  if (h1s.length === 0) issues.push(issue("error", "h1_missing", "No H1 found"));
  if (h1s.length > 1) issues.push(issue("warn", "h1_multiple", `${h1s.length} H1 tags (prefer 1)`));
  if (jsonLd.length === 0) issues.push(issue("info", "jsonld_missing", "No JSON-LD structured data"));
  if (robots && /noindex/i.test(robots)) issues.push(issue("error", "noindex", `robots meta: ${robots}`));
  if (images.missingAlt > 0) {
    issues.push(
      issue("warn", "img_alt_missing", `${images.missingAlt} image(s) missing alt`)
    );
  }
  if (legacy.tagCount > 0) {
    issues.push(
      issue(
        "info",
        "deprecated_markup",
        `Deprecated markup: ${Object.entries(legacy.tags)
          .map(([k, n]) => `${n} <${k}>`)
          .join(", ")}`
      )
    );
  }
  if (redirects.count >= 3) {
    issues.push(
      issue("warn", "redirect_chain_long", `Redirect chain has ${redirects.count} hops`)
    );
  }
  if (robotsTxt && !robotsTxt.ok) {
    issues.push(
      issue("info", "robots_txt_missing", robotsTxt.error || "robots.txt not found")
    );
  }
  if (sitemap && !sitemap.ok) {
    issues.push(issue("info", "sitemap_missing", sitemap.error || "sitemap.xml not found"));
  }

  const severityScore = { error: 18, warn: 8, info: 3 };
  let penalty = 0;
  for (const i of issues) penalty += severityScore[i.severity] || 5;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const summary = {
    finalUrl,
    status,
    contentType,
    title: title ? stripTags(title).trim() : null,
    metaDescription: metaDesc,
    canonical,
    robots,
    viewport: Boolean(viewport),
    charset,
    lang,
    favicon: favicon.url,
    faviconSource: favicon.source,
    h1s,
    openGraph: og,
    twitter,
    jsonLdCount: jsonLd.length,
    jsonLdBlocks: ld.blocks,
    jsonLdDropped: ld.dropped,
    jsonLdTypes: jsonLd.map((j) => j["@type"] || j.type || "unknown").slice(0, 20),
    images,
    links,
    words,
    hreflang,
    legacy,
    redirects,
    robotsTxt,
    sitemap,
  };

  return {
    score,
    summary,
    issues,
    counts: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
    // Cru, não resumo: o cliente principal é agente e ele quer o payload inteiro
    // para validar schema. `jsonLdCount` acima continua sendo a contagem real,
    // mesmo quando esta lista vem cortada na persistência (ver saveAudit).
    jsonLd,
    headers: extra.headers || {},
    htmlTruncated: Boolean(extra.htmlTruncated),
  };
}

/**
 * Ícone declarado pela página, resolvido em absoluto.
 *
 * Sem `<link rel=icon>` devolve `/favicon.ico` na origem, que é exatamente o que o
 * browser tenta — mas marcado como `default`, porque nunca confirmamos que existe.
 * Quem renderiza precisa de fallback próprio.
 */
function faviconOf(html, baseUrl) {
  let best = null;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attrMatch(tag, /\brel=["']([^"']+)["']/i) || "").toLowerCase();
    // Casar `rel` por token, não por substring. `mask-icon` (silhueta monocromática
    // da pinned tab do Safari) e `fluid-icon` contêm "icon" mas não são favicon —
    // o GitHub declara os dois, e por substring o octocat chapado vencia o ícone real.
    const tokens = rel.split(/\s+/).filter(Boolean);
    const isPlain = tokens.includes("icon");
    const isApple =
      tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed");
    if (!isPlain && !isApple) continue;
    const href = attrMatch(tag, /\bhref=["']([^"']+)["']/i);
    if (!href) continue;
    const sizes = attrMatch(tag, /\bsizes=["']([^"']+)["']/i) || "";
    const px = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
    // Favicon de verdade ganha do apple-touch-icon, que vem com margem e fundo
    // próprios e fica pequeno demais depois de encaixar em 16px. Dentro do mesmo
    // tipo: SVG escala em qualquer densidade, senão o maior bitmap declarado.
    const isSvg = /\.svg(\?|#|$)/i.test(href) || /image\/svg/i.test(tag);
    const rank = (isPlain ? 1e6 : 0) + (isSvg ? 1e5 : Math.min(px, 99999));
    if (!best || rank > best.rank) best = { href, rank };
  }
  if (best) {
    const abs = resolveUrl(best.href, baseUrl);
    if (abs) return { url: abs, source: "declared" };
  }
  const fallback = resolveUrl("/favicon.ico", baseUrl);
  return fallback ? { url: fallback, source: "default" } : { url: null, source: "none" };
}

/** Resolve href relativo contra a URL final; só http(s) e data: de imagem passam. */
function resolveUrl(href, baseUrl) {
  try {
    const raw = String(href).trim();
    if (/^data:image\//i.test(raw)) return raw.length <= 8192 ? raw : null;
    const u = new URL(raw, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    /* href relativo/inválido: sem ícone em vez de URL quebrada */
    return null;
  }
}

function issue(severity, code, message) {
  return { severity, code, message };
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim() : null;
}

function attrMatch(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function metaContent(html, name) {
  const re = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || "").trim() : null;
}

function metaName(html, name) {
  return metaContent(html, name);
}

function metaProp(html, prop) {
  const re = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${prop}["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || "").trim() : null;
}

function charsetOf(html) {
  const m1 = html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i);
  if (m1) return m1[1];
  const m2 = html.match(/<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)/i);
  return m2 ? m2[1] : null;
}

/**
 * Blocos JSON-LD da página, com o que ficou de fora contabilizado.
 *
 * `blocks` conta todo `<script type=ld+json>` visto e `dropped` quanto passou do
 * teto — antes o corte era mudo (10 blocos, 5 nós por array) e um grafo grande
 * simplesmente encolhia sem sinal nenhum para quem lê o JSON.
 */
function extractJsonLd(html) {
  const out = [];
  let blocks = 0;
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    blocks++;
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* bloco ld+json malformado: conta o erro, não aborta o audit */
      out.push({ parseError: true });
    }
  }
  return {
    nodes: out.slice(0, MAX_JSONLD_NODES),
    blocks,
    dropped: Math.max(0, out.length - MAX_JSONLD_NODES),
  };
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, " ");
}
