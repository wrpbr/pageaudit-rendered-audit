/**
 * F2 — preview de como o link aparece em cada plataforma.
 * Só lê summary.openGraph / summary.twitter. Nada de fetch, nada de HTML do alvo.
 */

const PLATAFORMAS = [
  {
    id: "x",
    label: "X",
    icon: "bi-twitter-x",
    pick: (og, tw) => ({
      title: tw.title || og.title,
      description: tw.description || og.description,
      image: tw.image || og.image,
      url: og.url,
      site_name: og.site_name,
    }),
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "bi-linkedin",
    pick: (og) => ({
      title: og.title,
      description: og.description,
      image: og.image,
      url: og.url,
      site_name: og.site_name,
    }),
  },
  {
    id: "slack",
    label: "Slack",
    icon: "bi-slack",
    pick: (og) => ({
      title: og.title,
      description: og.description,
      image: og.image,
      url: og.url,
      site_name: og.site_name,
    }),
  },
  {
    id: "discord",
    label: "Discord",
    icon: "bi-discord",
    pick: (og) => ({
      title: og.title,
      description: og.description,
      image: og.image,
      url: og.url,
      site_name: og.site_name,
    }),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "bi-whatsapp",
    pick: (og) => ({
      title: og.title,
      description: og.description,
      image: og.image,
      url: og.url,
      site_name: og.site_name,
    }),
  },
];

/** URL do alvo só vira src/href se for http(s) absoluto. javascript:/data:/relativo = null. */
export function urlSegura(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function texto(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function hostDe(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export function montarCards(summary) {
  const s = summary || {};
  const og = s.openGraph || {};
  const tw = s.twitter || {};
  return PLATAFORMAS.map((p) => {
    const picked = p.pick(og, tw);
    const title = texto(picked.title);
    const description = texto(picked.description);
    const image = urlSegura(picked.image);
    const url = urlSegura(picked.url);
    const site_name = texto(picked.site_name);
    const missing = [];
    if (!title) missing.push("title");
    if (!description) missing.push("description");
    if (!image) missing.push("image");
    return {
      id: p.id,
      label: p.label,
      icon: p.icon,
      title,
      description,
      image,
      url,
      site_name,
      host: hostDe(url) || site_name,
      missing,
    };
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function cardEl(c) {
  const col = el("div", "col");
  const card = el("article", "card h-100 pa-preview-card");
  card.setAttribute("data-preview", c.id);

  const head = el("div", "card-header py-2 small d-flex align-items-center gap-2");
  const icon = el("i", "bi " + c.icon);
  icon.setAttribute("aria-hidden", "true");
  head.append(icon, document.createTextNode(c.label));
  card.appendChild(head);

  if (c.image) {
    const img = document.createElement("img");
    img.className = "card-img-top pa-preview-img";
    img.src = c.image;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.replaceWith(el("div", "pa-preview-ph small text-body-secondary", "Image failed to load"));
    });
    card.appendChild(img);
  } else {
    card.appendChild(el("div", "pa-preview-ph small text-body-secondary", "No image"));
  }

  const body = el("div", "card-body py-2");
  if (c.host) body.appendChild(el("div", "small text-body-secondary text-truncate", c.host));
  body.appendChild(el("div", c.title ? "fw-semibold pa-preview-title" : "fw-semibold pa-preview-title missing", c.title || "No title"));
  body.appendChild(el("div", c.description ? "small pa-preview-desc" : "small pa-preview-desc missing", c.description || "No description"));
  card.appendChild(body);

  if (c.missing.length) {
    const foot = el("div", "card-footer py-1 small text-body-secondary");
    foot.textContent = "Missing: " + c.missing.join(", ");
    card.appendChild(foot);
  }

  col.appendChild(card);
  return col;
}

/** Painel da aba. Só no browser — o Worker da página pública não embute og:image do alvo. */
export function montarPainel(summary) {
  const wrap = el("section", "pa-preview mb-4");
  const h = el("h3", "h6 d-flex align-items-center gap-2 mb-2");
  const i = el("i", "bi bi-window-stack");
  i.setAttribute("aria-hidden", "true");
  h.append(i, document.createTextNode(" How this link previews"));
  wrap.appendChild(h);
  const hint = el(
    "p",
    "small text-body-secondary mb-2",
    "Same Open Graph and X tags already in the report. Cards restore with the saved result.",
  );
  wrap.appendChild(hint);
  const row = el("div", "row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3");
  for (const c of montarCards(summary)) row.appendChild(cardEl(c));
  wrap.appendChild(row);
  return wrap;
}
