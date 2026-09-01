/* global bootstrap, document, fetch, URL, window */

const TAB_ID = "rendered-comparison";
const quickInput = document.querySelector("#quick-audit-url");
const quickMessage = document.querySelector("#quick-audit-msg");
const sandboxButton = actionButton("Sandbox verification", "bi-shield-check", runFromQuickInput);

document.querySelector("#quick-audit-actions")?.appendChild(sandboxButton);

async function runFromQuickInput() {
  const target = normalizeUrl(quickInput?.value || "");
  if (!target) {
    showError("Enter a valid public HTTP(S) URL.");
    quickInput?.focus();
    return;
  }
  quickInput.value = target;
  quickMessage.hidden = true;
  setBusy(true);
  showLoading(target);
  try {
    const response = await fetch("/api/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: target }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Comparison failed (HTTP ${response.status}).`);
    renderComparison(payload);
  } catch (error) {
    showFailure(target, error.message || "Unable to complete the comparison.");
  } finally {
    setBusy(false);
  }
}

function actionButton(label, icon, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-primary btn-lg";
  button.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i> ${label}`;
  button.addEventListener("click", action);
  return button;
}

function ensurePane(target) {
  let trigger = document.querySelector("#trigger-rendered-comparison");
  let pane = document.querySelector("#pane-rendered-comparison");
  if (!trigger) {
    const item = document.createElement("li");
    item.className = "nav-item pa-rendered-tab position-relative";
    trigger = document.createElement("button");
    trigger.id = "trigger-rendered-comparison";
    trigger.type = "button";
    trigger.className = "nav-link";
    trigger.setAttribute("data-bs-toggle", "tab");
    trigger.setAttribute("data-bs-target", "#pane-rendered-comparison");
    trigger.innerHTML = '<i class="bi bi-shield-check" aria-hidden="true"></i> <span class="pa-tab-label">Sandbox verification</span>';
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close pa-tab-x";
    close.setAttribute("aria-label", "Close sandbox verification");
    close.addEventListener("click", closePane);
    item.append(trigger, close);
    document.querySelector("#tab-strip")?.insertBefore(item, document.querySelector("#tab-add-item"));
  }
  if (!pane) {
    pane = document.createElement("div");
    pane.id = "pane-rendered-comparison";
    pane.className = "tab-pane fade pa-rendered-pane";
    pane.setAttribute("role", "tabpanel");
    document.querySelector("#tab-panes")?.appendChild(pane);
  }
  trigger.title = target;
  new bootstrap.Tab(trigger).show();
  return pane;
}

function closePane(event) {
  event.preventDefault();
  event.stopPropagation();
  document.querySelector(".pa-rendered-tab")?.remove();
  document.querySelector(".pa-rendered-pane")?.remove();
  new bootstrap.Tab(document.querySelector("#tab-start")).show();
}

function showLoading(target) {
  const pane = ensurePane(target);
  pane.innerHTML = `<div class="d-flex align-items-center gap-2 py-5 justify-content-center text-body-secondary">
    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
    <span>Running the HTTP audit and sandbox verification…</span>
  </div>`;
}

function showFailure(target, error) {
  const pane = ensurePane(target);
  pane.textContent = "";
  pane.appendChild(resultHeader(target));
  const alert = document.createElement("div");
  alert.className = "alert alert-danger";
  alert.textContent = error;
  pane.appendChild(alert);
}

function renderComparison(payload) {
  const pane = ensurePane(payload.target);
  pane.textContent = "";
  pane.appendChild(resultHeader(payload.target));

  const summary = document.createElement("div");
  summary.className = "row g-3 mb-3";
  summary.append(
    metric("HTTP score", payload.http.score),
    metric("Rendered score", payload.sandbox.score),
    metric("Score change", signed(payload.sandbox.score - payload.http.score)),
    metric("Changed checks", payload.changes.length),
  );
  pane.appendChild(summary);

  const reports = document.createElement("div");
  reports.className = "row g-3";
  reports.append(
    reportCard("Server response", "HTML returned by the server, before page scripts run.", payload.http),
    reportCard("Sandbox verification", "Page after scripts run in an isolated browser.", payload.sandbox),
  );
  pane.appendChild(reports);
  pane.appendChild(changesTable(payload.changes));
}

function resultHeader(target) {
  const head = document.createElement("div");
  head.className = "d-flex flex-wrap gap-2 align-items-start justify-content-between mb-3";
  const info = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "h5 mb-1";
  title.textContent = "Sandbox verification";
  const link = document.createElement("a");
  link.className = "small text-body-secondary text-break";
  link.href = target;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = target;
  info.append(title, link);
  const rerun = actionButton("Run again", "bi-arrow-clockwise", () => runForTarget(target));
  rerun.className = "btn btn-sm btn-outline-primary";
  head.append(info, rerun);
  return head;
}

function metric(label, value) {
  const col = document.createElement("div");
  col.className = "col-6 col-lg-3";
  col.innerHTML = `<div class="border rounded bg-body p-3 h-100"><div class="small text-body-secondary"></div><div class="h4 mb-0"></div></div>`;
  col.querySelector(".small").textContent = label;
  col.querySelector(".h4").textContent = value;
  return col;
}

function reportCard(title, subtitle, result) {
  const col = document.createElement("section");
  col.className = "col-12 col-xl-6";
  const card = document.createElement("div");
  card.className = "card h-100";
  const head = document.createElement("div");
  head.className = "card-header";
  head.innerHTML = '<div class="fw-semibold"></div><div class="small text-body-secondary"></div>';
  head.children[0].textContent = title;
  head.children[1].textContent = subtitle;
  const body = document.createElement("div");
  body.className = "card-body";
  const report = window.resultBlock(TAB_ID + "-" + title, result);
  report.querySelector("details")?.remove();
  body.appendChild(report);
  card.append(head, body);
  col.appendChild(card);
  return col;
}

function changesTable(changes) {
  const section = document.createElement("section");
  section.className = "mt-4";
  const title = document.createElement("h3");
  title.className = "h6";
  title.textContent = "What changed after rendering";
  section.appendChild(title);
  if (!changes.length) {
    const empty = document.createElement("p");
    empty.className = "text-body-secondary small";
    empty.textContent = "No audited field changed.";
    section.appendChild(empty);
    return section;
  }
  const wrap = document.createElement("div");
  wrap.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-sm align-middle";
  table.innerHTML = "<thead><tr><th>Check</th><th>Server response</th><th>Sandbox-rendered page</th></tr></thead><tbody></tbody>";
  for (const change of changes) {
    const row = table.tBodies[0].insertRow();
    for (const value of [change.label || change.field, display(change.before), display(change.after)]) row.insertCell().textContent = value;
  }
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

function normalizeUrl(raw) {
  try {
    const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function display(value) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return "Not found";
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function signed(value) { return value > 0 ? `+${value}` : String(value); }
function runForTarget(target) {
  if (quickInput) quickInput.value = target;
  return runFromQuickInput();
}
function showError(text) {
  if (!quickMessage) return;
  quickMessage.textContent = text;
  quickMessage.hidden = false;
}
function setBusy(busy) { sandboxButton.disabled = busy; }
