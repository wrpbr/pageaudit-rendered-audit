/**
 * Painel de compartilhamento da aba: link público + badge SVG (F4).
 * A UI só monta o que POST /api/audits/:id/share já devolveu.
 */

export function shareState(slug, origin) {
  const url = `${origin}/r/${slug}`;
  const badge = `${origin}/badge/${slug}.svg`;
  return {
    slug,
    url,
    badge,
    markdown: `[![PageAudit](${badge})](${url})`,
  };
}

export function adoptShare(result, origin) {
  if (!result || typeof result.share_slug !== "string" || !result.share_slug) return null;
  return shareState(result.share_slug, origin);
}

function btn(cls, html) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = cls;
  el.innerHTML = html;
  return el;
}

function copyBtn(getText, label) {
  const el = btn("btn btn-sm btn-primary", `<i class="bi bi-clipboard" aria-hidden="true"></i> ${label}`);
  el.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      el.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Copied';
      setTimeout(() => {
        el.innerHTML = `<i class="bi bi-clipboard" aria-hidden="true"></i> ${label}`;
      }, 1500);
    } catch {
      /* caller selects the field */
    }
  });
  return el;
}

/**
 * @param {{ slug: string, url: string, badge: string, markdown: string, error?: string }} info
 * @param {{ onRevoke: () => void }} hooks
 */
export function shareBlock(info, { onRevoke }) {
  const box = document.createElement("div");
  box.className = "alert alert-secondary py-2";
  if (info.error) {
    box.className = "alert alert-danger py-2";
    box.textContent = "Could not share: " + info.error;
    return box;
  }

  const row = document.createElement("div");
  row.className = "d-flex flex-wrap align-items-center gap-2";

  const label = document.createElement("span");
  label.className = "small";
  label.innerHTML = '<i class="bi bi-link-45deg" aria-hidden="true"></i> Public link:';

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm flex-grow-1";
  input.readOnly = true;
  input.value = info.url;
  input.setAttribute("aria-label", "Public report URL");
  input.addEventListener("focus", () => input.select());

  const open = document.createElement("a");
  open.className = "btn btn-sm btn-outline-secondary";
  open.href = info.url;
  open.target = "_blank";
  open.rel = "noopener";
  open.innerHTML = '<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> Open';

  const revoke = btn(
    "btn btn-sm btn-outline-danger",
    '<i class="bi bi-slash-circle" aria-hidden="true"></i> Revoke'
  );
  revoke.addEventListener("click", onRevoke);

  row.append(label, input, copyBtn(() => info.url, "Copy"), open, revoke);

  const badgeRow = document.createElement("div");
  badgeRow.className = "d-flex flex-wrap align-items-center gap-2 mt-2";

  const img = document.createElement("img");
  img.src = info.badge;
  img.alt = "PageAudit score badge";
  img.width = 110;
  img.height = 20;
  img.className = "flex-shrink-0";

  const md = document.createElement("input");
  md.type = "text";
  md.className = "form-control form-control-sm font-monospace flex-grow-1";
  md.readOnly = true;
  md.value = info.markdown;
  md.setAttribute("aria-label", "Markdown for README badge");
  md.addEventListener("focus", () => md.select());

  const mdLabel = document.createElement("span");
  mdLabel.className = "small text-body-secondary";
  mdLabel.innerHTML = '<i class="bi bi-markdown" aria-hidden="true"></i> README:';

  badgeRow.append(img, mdLabel, md, copyBtn(() => info.markdown, "Copy markdown"));

  box.append(row, badgeRow);
  return box;
}
