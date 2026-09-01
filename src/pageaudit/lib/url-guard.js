/**
 * Normalização de URL + guarda SSRF textual.
 *
 * Não resolve DNS: `evil.com` apontando para 127.0.0.1 ainda passa
 * (SECURITY.md §2, residual). O que dá para recusar no hostname — loopback,
 * RFC1918, link-local, decimal/octal/hex, IPv6-mapped — cai aqui.
 * Cada hop de redirect tem que passar de novo por `normalizeUrl`.
 */

export function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 2048) return null;
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (hostIsBlocked(u.hostname)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Stable dedupe key so the same page never opens twice as a tab. */
export function urlKey(normalized) {
  try {
    const u = new URL(normalized);
    const path = u.pathname.replace(/\/+$/, "");
    return (u.protocol + "//" + u.host).toLowerCase() + path + u.search;
  } catch {
    return String(normalized || "").toLowerCase();
  }
}

/** Label a tab by its domain (never the full URL). */
export function hostLabel(normalized) {
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "page";
  }
}

/** First path segment, used to disambiguate two tabs on the same domain. */
export function firstPathSegment(normalized) {
  try {
    const segs = new URL(normalized).pathname.split("/").filter(Boolean);
    return segs.length ? segs[0].slice(0, 24) : null;
  } catch {
    return null;
  }
}

export function hostIsBlocked(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host.includes(":")) return ipv6IsBlocked(host);
  const v4 = parseCanonicalIPv4(host);
  if (v4) return ipv4IsBlocked(v4);
  if (looksLikeIpv4Evasion(host)) return true;
  return false;
}

/** Dotted decimal canônico: 4 octetos, sem zero à esquerda (exceto o próprio 0). */
function parseCanonicalIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [];
  for (let i = 1; i <= 4; i++) {
    const p = m[i];
    if (p.length > 1 && p.startsWith("0")) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    parts.push(n);
  }
  return parts;
}

function looksLikeIpv4Evasion(host) {
  if (/0x/i.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (
    /^(0\d+|0x[0-9a-f]+|\d+)(\.(0\d+|0x[0-9a-f]+|\d+)){1,3}$/i.test(host) &&
    !parseCanonicalIPv4(host)
  ) {
    return true;
  }
  return false;
}

function ipv4IsBlocked([a, b]) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6IsBlocked(host) {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "::" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^0?(:0)+$/.test(h) || /^0?(:0)+:0?1$/.test(h)) return true;
  const mappedDot = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedDot) {
    const v4 = parseCanonicalIPv4(mappedDot[1]);
    return v4 ? ipv4IsBlocked(v4) : true;
  }
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return ipv4IsBlocked([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
  }
  const first = (h.split(":")[0] || "0").replace(/\[/g, "");
  const n = parseInt(first.padEnd(4, "0"), 16);
  if (!Number.isFinite(n)) return false;
  if ((n & 0xffc0) === 0xfe80) return true;
  if ((n & 0xfe00) === 0xfc00) return true;
  return false;
}
