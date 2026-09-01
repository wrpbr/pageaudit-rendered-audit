/**
 * Progressive enhancement da landing F3: POST /api/audit e mostra só os
 * checks desta ferramenta. Sem JS o form cai no workspace (`action="/"`).
 */
import { buildChecks } from "./checks.js";

const STATUS = {
  pass: { icon: "bi-check-circle-fill", label: "OK" },
  warn: { icon: "bi-exclamation-triangle-fill", label: "Should fix" },
  fail: { icon: "bi-x-circle-fill", label: "Fix this" },
  info: { icon: "bi-info-circle-fill", label: "Optional" },
};

function spec() {
  const el = document.getElementById("tool-spec");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "null");
  } catch {
    return null;
  }
}

function setStatus(el, text, kind) {
  el.hidden = !text;
  el.textContent = text || "";
  el.className = "small mt-2" + (kind === "error" ? " text-danger" : " text-body-secondary");
}

function serpHtml(summary) {
  const title = summary.title || "No title tag";
  const desc = summary.metaDescription || "No meta description";
  let host = "";
  let path = "";
  try {
    const u = new URL(summary.finalUrl);
    if (u.protocol === "http:" || u.protocol === "https:") {
      host = u.hostname.replace(/^www\./i, "");
      path = u.pathname === "/" ? "" : u.pathname;
    }
  } catch {
    /* URL hostil ou ausente: o recorte fica sem endereço */
  }
  const addr = host ? host + path : "address unavailable";
  return (
    `<div class="serp mb-3" aria-label="Search snippet preview">` +
    `<div class="serp-url"></div>` +
    `<div class="serp-title"></div>` +
    `<div class="serp-desc"></div></div>`
  )
    .replace(
      'serp-url"></div>',
      `serp-url">${esc(addr)}</div>`
    )
    .replace('serp-title"></div>', `serp-title">${esc(title)}</div>`)
    .replace('serp-desc"></div>', `serp-desc">${esc(desc)}</div>`);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function checksHtml(items) {
  return items
    .map((c) => {
      const ui = STATUS[c.status] || STATUS.info;
      const value = c.value
        ? `<div class="check-val">${esc(c.value)}</div>`
        : `<div class="check-val text-body-secondary fst-italic">not set</div>`;
      const detail = c.detail ? `<div class="small text-body-secondary">${esc(c.detail)}</div>` : "";
      const note = c.note ? `<div class="small text-body-secondary">${esc(c.note)}</div>` : "";
      const fix =
        c.status === "pass" ? "" : `<p class="small mb-0 mt-2"><strong>How to fix.</strong> ${esc(c.fix)}</p>`;
      return (
        `<div class="check">` +
        `<div class="d-flex align-items-center gap-2 fw-semibold">` +
        `<i class="bi ${ui.icon}" aria-hidden="true"></i>` +
        `<span>${esc(c.label)}</span>` +
        `<span class="badge text-bg-secondary ms-auto">${esc(ui.label)}</span></div>` +
        value +
        detail +
        note +
        `<p class="small text-body-secondary mt-2 mb-0"><strong>Why it matters.</strong> ${esc(c.why)}</p>` +
        fix +
        `</div>`
      );
    })
    .join("");
}

async function run(url, tool) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  /* 402 e 403 são a mesma coisa para a pessoa no browser: "faça o desafio".
     O 402 é o mesmo corpo com `accepts[]` a mais, para o agente pagar em vez de
     resolver captcha — caminho que browser nenhum toma. */
  if ((res.status === 403 || res.status === 402) && data.code) {
    const err = new Error("verification");
    err.code = data.code;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Audit failed");
    err.status = res.status;
    throw err;
  }
  const wanted = new Set(tool.checks || []);
  const focused = buildChecks(data.summary, data.issues).checks.filter((c) => wanted.has(c.id));
  return { data, focused };
}

function paint(box, tool, payload) {
  const { data, focused } = payload;
  const serp = tool.serp ? serpHtml(data.summary || {}) : "";
  const score =
    data.score == null
      ? ""
      : `<p class="small mb-2">Full-page score <strong>${esc(String(data.score))}</strong>/100 — this tool only shows the ${esc(tool.slug.replace(/-/g, " "))} checks.</p>`;
  box.innerHTML =
    serp +
    score +
    checksHtml(focused) +
    `<p class="mt-3 mb-0"><a class="btn btn-sm btn-outline-primary" href="/">` +
    `<i class="bi bi-window-stack" aria-hidden="true"></i> Open the full workspace</a></p>`;
  box.hidden = false;
}

const tool = spec();
const form = document.getElementById("tool-form");
const status = document.getElementById("tool-status");
const result = document.getElementById("tool-result");
if (tool && form && status && result) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const url = (document.getElementById("tool-url") || {}).value;
    result.hidden = true;
    result.replaceChildren();
    setStatus(status, "Checking…", "info");
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const payload = await run(url, tool);
      setStatus(status, "", "info");
      paint(result, tool, payload);
    } catch (e) {
      result.hidden = true;
      if (e && e.code) {
        setStatus(
          status,
          "Today's free check is used up. Open the workspace to continue (it will ask for verification).",
          "error"
        );
      } else {
        setStatus(status, e && e.message ? e.message : "Could not audit that URL.", "error");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
