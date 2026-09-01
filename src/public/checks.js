/**
 * Catálogo de checagens: transforma o `summary` cru num relatório legível —
 * cada item com status, o valor encontrado, por que importa e o que fazer.
 *
 * Fonte da verdade do STATUS continua sendo `issues` (produzido por analyzeHtml):
 * aqui só juntamos valor + explicação por código de issue. Assim a nota, a lista de
 * issues e este relatório nunca divergem, e mudar regra continua sendo num lugar só.
 *
 * Mora em `public/` de propósito: é o MESMO arquivo consumido pelos dois lados —
 * o browser importa via `/checks.js` e o Worker importa em `src/lib/share.js` para
 * renderizar `/r/:slug`. Uma cópia só, sem catálogo duplicado que sai de sincronia.
 */

import { CATEGORIES, CHECK_CATALOG } from "./checks-catalog.js";

export { CHECK_CATALOG };

const SEVERITY_TO_STATUS = { error: "fail", warn: "warn", info: "info" };
const RANK = { fail: 3, warn: 2, info: 1, pass: 0 };

/**
 * @param {object} summary  summary do audit
 * @param {Array}  issues   issues do audit (fonte do status)
 * @returns {{ categories: Array, checks: Array, totals: object }}
 */
export function buildChecks(summary, issues) {
  const s = summary || {};
  const byCode = new Map();
  for (const i of issues || []) {
    if (i && i.code) byCode.set(i.code, i);
  }

  const checks = CHECK_CATALOG.map((c) => {
    const matched = (c.codes || []).map((code) => byCode.get(code)).filter(Boolean);
    let status = "pass";
    for (const m of matched) {
      const st = SEVERITY_TO_STATUS[m.severity] || "warn";
      if (RANK[st] > RANK[status]) status = st;
    }
    let value;
    try {
      value = c.value(s);
    } catch {
      /* valor derivado do summary não pode derrubar o relatório */
      value = null;
    }
    // Checagem sem código de issue: informativa, não penaliza a nota.
    if (!c.codes && !value) status = "info";

    return {
      id: c.id,
      category: c.category,
      label: c.label,
      status,
      value: value || null,
      detail: matched.map((m) => m.message).join(" · ") || null,
      note: (typeof c.note === "function" ? c.note(s) : null) || null,
      why: c.why,
      fix: c.fix,
    };
  });

  const totals = { pass: 0, warn: 0, fail: 0, info: 0 };
  const perCategory = {};
  for (const c of checks) {
    totals[c.status] = (totals[c.status] || 0) + 1;
    perCategory[c.category] = perCategory[c.category] || { pass: 0, warn: 0, fail: 0, info: 0 };
    perCategory[c.category][c.status] += 1;
  }

  return {
    categories: CATEGORIES.map((cat) => ({ ...cat, counts: perCategory[cat.id] || null })),
    checks,
    totals,
  };
}
