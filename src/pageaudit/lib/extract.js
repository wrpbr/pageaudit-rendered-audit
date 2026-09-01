/**
 * Extrações F3b a partir do HTML já baixado. Puras: sem I/O.
 * Nada daqui vira href/src sozinho — quem renderiza escapa.
 */

const DEPRECATED = [
  "font",
  "center",
  "marquee",
  "blink",
  "big",
  "strike",
  "tt",
  "frame",
  "frameset",
  "applet",
  "basefont",
  "dir",
  "isindex",
  "nobr",
];

const MAX_HREFLANG = 50;
const MAX_MISSING_SRC = 8;

export function attrOf(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = String(tag).match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? "";
}

export function extractImages(html) {
  let total = 0;
  let withText = 0;
  let emptyAlt = 0;
  let missingAlt = 0;
  const missingSrc = [];
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    total++;
    const tag = m[0];
    const alt = attrOf(tag, "alt");
    if (alt === null) {
      missingAlt++;
      if (missingSrc.length < MAX_MISSING_SRC) missingSrc.push(attrOf(tag, "src") || "");
    } else if (alt.trim() === "") {
      emptyAlt++;
    } else {
      withText++;
    }
  }
  return { total, withText, emptyAlt, missingAlt, missingSrc };
}

export function extractLinks(html, pageUrl) {
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    /* pageUrl inválida: tudo que resolver conta como externo */
  }
  let internal = 0;
  let external = 0;
  let nofollow = 0;
  let skipped = 0;
  for (const m of String(html).matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    const href = (attrOf(tag, "href") || "").trim();
    if (
      !href ||
      href.startsWith("#") ||
      /^(mailto|tel|javascript|data):/i.test(href)
    ) {
      skipped++;
      continue;
    }
    const rel = (attrOf(tag, "rel") || "").toLowerCase();
    if (/\bnofollow\b/.test(rel)) nofollow++;
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        skipped++;
        continue;
      }
      if (origin && u.origin === origin) internal++;
      else external++;
    } catch {
      skipped++;
    }
  }
  return { total: internal + external, internal, external, nofollow, skipped };
}

export function countWords(html) {
  const stripped = String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
  let n = 0;
  for (const w of stripped.split(/\s+/)) {
    if (/[0-9A-Za-zÀ-ÿ]/.test(w)) n++;
  }
  return n;
}

export function extractHreflang(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attrOf(tag, "rel") || "").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate")) continue;
    const lang = (attrOf(tag, "hreflang") || "").trim();
    const href = (attrOf(tag, "href") || "").trim();
    if (!lang || !href) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const key = lang.toLowerCase() + "\0" + abs;
    if (seen.has(key)) continue;
    seen.add(key);
    if (links.length < MAX_HREFLANG) links.push({ lang, href: abs });
  }
  return { count: seen.size, links };
}

export function extractLegacy(html) {
  const tags = {};
  let tagCount = 0;
  const src = String(html);
  for (const name of DEPRECATED) {
    const re = new RegExp(`<${name}\\b`, "gi");
    const n = (src.match(re) || []).length;
    if (n) {
      tags[name] = n;
      tagCount += n;
    }
  }
  const inlineStyle = (src.match(/\sstyle\s*=/gi) || []).length;
  const styleBlocks = (src.match(/<style\b/gi) || []).length;
  return { tags, tagCount, inlineStyle, styleBlocks };
}
