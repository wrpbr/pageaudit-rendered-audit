/**
 * Segue a cadeia de redirect com `redirect: "manual"`.
 * Cada Location passa por `normalizeUrl` antes do próximo fetch —
 * sem isso um 302 para 169.254.169.254 fura o guarda que só viu a URL inicial.
 */

export const MAX_REDIRECTS = 10;

export async function fetchWithRedirects(startUrl, opts) {
  const {
    fetch: doFetch = globalThis.fetch.bind(globalThis),
    normalizeUrl,
    maxRedirects = MAX_REDIRECTS,
    headers = {},
    signal,
    cf,
  } = opts;

  const hops = [];
  const seen = new Set();
  let current = startUrl;

  for (let n = 0; n <= maxRedirects; n++) {
    const url = normalizeUrl(current);
    if (!url) {
      return {
        ok: false,
        status: 400,
        error: "Redirect target is not allowed",
        detail: n === 0 ? "" : "A hop failed the public-URL check",
        hops,
        blocked: true,
      };
    }
    if (seen.has(url)) {
      return { ok: false, status: 422, error: "Redirect loop", hops, loop: true };
    }
    seen.add(url);

    let res;
    try {
      res = await doFetch(url, { redirect: "manual", headers, signal, cf });
    } catch (err) {
      const raw = String(err?.message || err);
      return {
        ok: false,
        status: 502,
        error: /timed? ?out|aborted/i.test(raw)
          ? "Timed out fetching URL"
          : "Failed to fetch URL",
        detail: /internal error; reference/i.test(raw) ? "" : raw,
        hops,
      };
    }

    const status = res.status;
    const location = res.headers.get("location");
    const isRedirect = status >= 300 && status < 400 && status !== 304;

    if (!isRedirect) {
      hops.push({ url, status, location: null });
      return { ok: true, response: res, finalUrl: url, hops };
    }

    if (!location || !String(location).trim()) {
      hops.push({ url, status, location: null });
      await cancelBody(res);
      return { ok: false, status: 422, error: "Redirect without Location", hops };
    }

    if (n === maxRedirects) {
      hops.push({ url, status, location: null });
      await cancelBody(res);
      return { ok: false, status: 422, error: "Too many redirects", hops, truncated: true };
    }

    let next;
    try {
      next = new URL(String(location).trim(), url).toString();
    } catch {
      hops.push({ url, status, location: null });
      await cancelBody(res);
      return { ok: false, status: 422, error: "Redirect Location is not a valid URL", hops };
    }
    const allowed = normalizeUrl(next);
    // Só grava Location que passou no guarda — IP privado não entra no D1.
    hops.push({ url, status, location: allowed });
    await cancelBody(res);
    if (!allowed) {
      return {
        ok: false,
        status: 400,
        error: "Redirect target is not allowed",
        detail: "A hop failed the public-URL check",
        hops,
        blocked: true,
      };
    }
    current = allowed;
  }

  return { ok: false, status: 422, error: "Too many redirects", hops, truncated: true };
}

export function redirectSummary(hops, finalUrl) {
  const list = Array.isArray(hops) ? hops : [];
  const count = list.filter((h) => h && h.status >= 300 && h.status < 400 && h.status !== 304).length;
  return {
    hops: list.map((h) => ({
      url: h.url,
      status: h.status,
      location: h.location || null,
    })),
    count,
    finalUrl: finalUrl || (list.length ? list[list.length - 1].url : null),
  };
}

async function cancelBody(res) {
  try {
    if (res.body && typeof res.body.cancel === "function") await res.body.cancel();
  } catch {
    /* ignore */
  }
}
