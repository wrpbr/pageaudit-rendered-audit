const FIELDS = [
  ["status", "HTTP status"],
  ["title", "Title tag"],
  ["metaDescription", "Meta description"],
  ["canonical", "Canonical URL"],
  ["h1s", "H1 headings"],
  ["openGraph.title", "og:title"],
  ["openGraph.description", "og:description"],
  ["openGraph.image", "og:image"],
  ["twitter.card", "twitter:card"],
  ["viewport", "Mobile viewport"],
  ["charset", "Character encoding"],
  ["jsonLdCount", "JSON-LD blocks"],
  ["images.total", "Images"],
  ["images.missingAlt", "Images missing alt"],
  ["links.internal", "Internal links"],
  ["links.external", "External links"],
  ["words", "Visible words"],
];

export function comparePageAuditResults(http, sandbox) {
  const before = http?.summary || {};
  const after = sandbox?.summary || {};
  return FIELDS.flatMap(([field, label]) => {
    const left = fieldValue(before, field);
    const right = fieldValue(after, field);
    return stable(left) === stable(right) ? [] : [{ field, label, before: left, after: right }];
  });
}

function fieldValue(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function stable(value) {
  return JSON.stringify(value ?? null);
}
