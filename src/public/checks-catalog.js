/**
 * Catálogo de checagens (status + valor + why/fix). Fonte única do relatório.
 */

function normalize(u) {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    /* URL inválida: compara o texto cru */
    return String(u || "").toLowerCase();
  }
}

export const CATEGORIES = [
  { id: "indexing", label: "Indexing", icon: "bi-search" },
  { id: "crawl", label: "Crawl", icon: "bi-signpost-split" },
  { id: "content", label: "Content", icon: "bi-type" },
  { id: "social", label: "Social", icon: "bi-share" },
  { id: "data", label: "Structured data", icon: "bi-diagram-3" },
];

export const CHECK_CATALOG = [
  {
    id: "http_status",
    category: "indexing",
    label: "HTTP status",
    codes: ["http_status"],
    value: (s) => (s.status ? `HTTP ${s.status}` : null),
    why: "Search engines only index URLs that answer 200. Anything else and the page is dropped or never fetched.",
    fix: "Return 200 for pages you want indexed. Redirect or fix the ones that don't.",
  },
  {
    id: "redirects",
    category: "crawl",
    label: "Redirect chain",
    codes: ["redirect_chain_long"],
    value: (s) => {
      const r = s.redirects;
      if (!r) return null;
      if (!r.count) return "no redirects (direct response)";
      const chain = (r.hops || []).map((h) => h.status).join(" → ");
      return `${r.count} hop(s): ${chain}`;
    },
    why: "Each extra hop wastes crawl budget and can drop referrer data. A chain of three or more is a smell — flatten it to one 301.",
    fix: "Point the original URL straight at the final address with a single 301.",
  },
  {
    id: "robots_txt",
    category: "crawl",
    label: "robots.txt",
    codes: ["robots_txt_missing"],
    value: (s) => {
      const r = s.robotsTxt;
      if (!r) return null;
      if (!r.ok) return r.status ? `HTTP ${r.status}` : r.error || "not fetched";
      const n = (r.sitemaps || []).length;
      return (
        `HTTP ${r.status} · ${n} sitemap declaration(s)` +
        (r.disallowAll ? " · Disallow: / for *" : "")
      );
    },
    why: "Crawlers look here first. A missing file is not fatal, but it is where you declare the sitemap and keep bots out of staging paths.",
    fix: "Serve https://your-host/robots.txt as text/plain with at least a Sitemap: line.",
  },
  {
    id: "sitemap",
    category: "crawl",
    label: "XML sitemap",
    codes: ["sitemap_missing"],
    value: (s) => {
      const m = s.sitemap;
      if (!m) return null;
      if (!m.ok) return m.status ? `HTTP ${m.status}` : m.error || "not fetched";
      return `${m.kind || "xml"} · ${m.locCount} loc(s)`;
    },
    why: "A sitemap is the index of URLs you want crawled. Without one, new pages wait for a chance discovery.",
    fix: "Publish sitemap.xml (or the URL declared in robots.txt) listing the canonical addresses.",
  },
  {
    id: "hreflang",
    category: "indexing",
    label: "hreflang alternates",
    value: (s) => {
      const h = s.hreflang;
      if (!h || !h.count) return null;
      return `${h.count}: ${(h.links || []).map((x) => x.lang).join(", ")}`;
    },
    why: "Tells search engines which language or region variant to show. Missing it on a multilingual site mixes rankings.",
    fix: 'Add <link rel="alternate" hreflang="…" href="…"> for each language, including x-default.',
  },
  {
    id: "indexable",
    category: "indexing",
    label: "Indexable (robots meta)",
    codes: ["noindex"],
    value: (s) => s.robots || "no robots meta (defaults to indexable)",
    why: "A noindex directive removes the page from results no matter how good everything else is.",
    fix: "Drop noindex from the robots meta tag once the page is meant to rank.",
  },
  {
    id: "canonical",
    category: "indexing",
    label: "Canonical URL",
    codes: ["canonical_missing"],
    value: (s) => s.canonical,
    note: (s) =>
      s.canonical && s.finalUrl && normalize(s.canonical) !== normalize(s.finalUrl)
        ? "Points to a different URL than the one audited — intentional only if this page is a duplicate."
        : null,
    why: "Tells search engines which address is the original when the same content is reachable from several URLs, so ranking signals aren't split.",
    fix: 'Add <link rel="canonical" href="…"> in <head> with the absolute preferred URL.',
  },
  {
    id: "viewport",
    category: "indexing",
    label: "Mobile viewport",
    codes: ["viewport_missing"],
    value: (s) => (s.viewport ? "declared" : null),
    why: "Without it phones render the desktop layout zoomed out, which hurts mobile usability and ranking.",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
  },
  {
    id: "charset",
    category: "indexing",
    label: "Character encoding",
    codes: ["charset_missing"],
    value: (s) => s.charset,
    why: "Without a declared charset the browser guesses the encoding and accented characters can render as garbage.",
    fix: 'Put <meta charset="utf-8"> as the first element inside <head>.',
  },
  {
    id: "title",
    category: "content",
    label: "Title tag",
    codes: ["title_missing", "title_short", "title_long"],
    value: (s) => (s.title ? `${s.title}  (${s.title.length} chars)` : null),
    why: "The clickable headline in search results and the strongest on-page signal of what the page is about.",
    fix: "Write a unique title of roughly 15–60 characters, leading with the term the page should rank for.",
  },
  {
    id: "meta_description",
    category: "content",
    label: "Meta description",
    codes: [
      "meta_description_missing",
      "meta_description_short",
      "meta_description_long",
    ],
    value: (s) =>
      s.metaDescription ? `${s.metaDescription}  (${s.metaDescription.length} chars)` : null,
    why: "Not a ranking factor, but it is the sales copy under your title in the results — it decides whether people click.",
    fix: "Write 50–160 characters describing the page and giving a reason to click.",
  },
  {
    id: "h1",
    category: "content",
    label: "H1 heading",
    codes: ["h1_missing", "h1_multiple"],
    value: (s) =>
      Array.isArray(s.h1s) && s.h1s.length
        ? s.h1s.length === 1
          ? s.h1s[0]
          : `${s.h1s.length} H1s: ${s.h1s.join(" · ")}`
        : null,
    why: "The main heading states the page topic to readers and crawlers; exactly one keeps it unambiguous.",
    fix: "Use a single <h1> that matches what the page is actually about.",
  },
  {
    id: "images",
    category: "content",
    label: "Image alt text",
    codes: ["img_alt_missing"],
    value: (s) => {
      const im = s.images;
      if (!im || typeof im.total !== "number") return null;
      if (im.total === 0) return "no <img> tags";
      return `${im.total} images · ${im.missingAlt} missing alt · ${im.emptyAlt} decorative (empty alt)`;
    },
    why: "Alt text is what image search and screen readers get. An <img> without the attribute is a missed signal; alt=\"\" is fine for decoration.",
    fix: "Add a short alt describing the image. Use alt=\"\" only when the image is purely decorative.",
  },
  {
    id: "links",
    category: "content",
    label: "Internal / external links",
    value: (s) => {
      const l = s.links;
      if (!l) return null;
      return (
        `${l.internal} internal · ${l.external} external` +
        (l.nofollow ? ` · ${l.nofollow} nofollow` : "")
      );
    },
    why: "Internal links spread ranking and help crawlers find the next page. A page with none is a dead end.",
    fix: "Link to related pages on the same host with descriptive anchor text.",
  },
  {
    id: "word_count",
    category: "content",
    label: "Visible word count",
    value: (s) => (typeof s.words === "number" ? `${s.words} words` : null),
    why: "Thin pages have little to rank for. Word count is not a target — it is a sanity check that the HTML has readable text.",
    fix: "Write the substance on the page, not only in images or behind a script.",
  },
  {
    id: "legacy",
    category: "content",
    label: "Deprecated markup / inline CSS",
    codes: ["deprecated_markup"],
    value: (s) => {
      const g = s.legacy;
      if (!g) return null;
      const tags = Object.entries(g.tags || {})
        .map(([k, n]) => `${n} <${k}>`)
        .join(", ");
      return `${tags || "no deprecated tags"} · ${g.inlineStyle} inline style · ${g.styleBlocks} <style> blocks`;
    },
    why: "Presentational tags (<font>, <center>, <marquee>…) were replaced years ago and some browsers already ignore them.",
    fix: "Move presentation to CSS. Drop <font>, <center> and the other retired elements.",
  },
  {
    id: "og_title",
    category: "social",
    label: "og:title",
    codes: ["og_title_missing"],
    value: (s) => s.openGraph?.title,
    why: "The headline shown when the link is posted on LinkedIn, WhatsApp, Slack or Discord. Missing it and they fall back to whatever they can scrape.",
    fix: '<meta property="og:title" content="…"> in <head>.',
  },
  {
    id: "og_description",
    category: "social",
    label: "og:description",
    codes: ["og_description_missing"],
    value: (s) => s.openGraph?.description,
    why: "The supporting line in the social card; without it the preview looks bare and gets fewer clicks.",
    fix: '<meta property="og:description" content="…"> in <head>.',
  },
  {
    id: "og_image",
    category: "social",
    label: "og:image",
    codes: ["og_image_missing"],
    value: (s) => s.openGraph?.image,
    why: "The picture in the preview card, and by far the biggest driver of engagement when a link is shared.",
    fix: 'Add <meta property="og:image" content="…"> with an absolute URL, ideally 1200×630.',
  },
  {
    id: "og_url",
    category: "social",
    label: "og:url",
    value: (s) => s.openGraph?.url,
    why: "Gives the canonical address for the shared card so reshares from tracking URLs still point home.",
    fix: '<meta property="og:url" content="…"> with the absolute URL.',
  },
  {
    id: "og_type",
    category: "social",
    label: "og:type",
    value: (s) => s.openGraph?.type,
    why: "Tells the platform what kind of thing this is (website, article, product), which changes how the card renders.",
    fix: '<meta property="og:type" content="website"> — or "article" for posts.',
  },
  {
    id: "og_site_name",
    category: "social",
    label: "og:site_name",
    value: (s) => s.openGraph?.site_name,
    why: "Shows your brand next to the card instead of a bare domain.",
    fix: '<meta property="og:site_name" content="Your brand">.',
  },
  {
    id: "twitter_card",
    category: "social",
    label: "twitter:card",
    codes: ["twitter_card_missing"],
    value: (s) => s.twitter?.card,
    why: "Chooses the card format on X. Without it the link may render as a plain text row instead of an image card.",
    fix: '<meta name="twitter:card" content="summary_large_image">.',
  },
  {
    id: "jsonld",
    category: "data",
    label: "JSON-LD structured data",
    codes: ["jsonld_missing"],
    value: (s) =>
      s.jsonLdCount
        ? `${s.jsonLdCount} block(s): ${(s.jsonLdTypes || []).join(", ") || "unknown type"}`
        : null,
    why: "Feeds rich results — ratings, breadcrumbs, FAQs, product info. Without it you get the plain blue link.",
    fix: 'Add a <script type="application/ld+json"> block with schema.org markup matching the page (Article, Product, Organization…).',
  },
];
