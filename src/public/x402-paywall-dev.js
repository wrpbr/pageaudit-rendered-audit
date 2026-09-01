/**
 * x402 paywall — ticket de dev (sessionStorage + banner + X-X402-Dev).
 * Carregar ANTES de /x402-paywall.js.
 */
(function (global) {
  "use strict";

  var x = (global.__x402 = global.__x402 || {});
  var DEV_KEY = "x402_dev";

  /** Parse exp from short ticket v1.<exp>.<sig>; null if long-lived or unknown. */
  function ticketExp(ticket) {
    var m = /^v1\.(\d{10,12})\./.exec(String(ticket || ""));
    return m ? Number(m[1]) : null;
  }

  function ticketStillValid(ticket) {
    var exp = ticketExp(ticket);
    if (exp == null) return Boolean(ticket); // long-lived agent secret
    return Math.floor(Date.now() / 1000) < exp;
  }

  function showDevBanner(secondsLeft) {
    try {
      var id = "x402-dev-banner";
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "status");
        el.style.cssText =
          "position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:2000;" +
          "background:#ffc107;color:#111;padding:.55rem 1rem;border-radius:999px;" +
          "font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);";
        document.body.appendChild(el);
      }
      if (secondsLeft == null || secondsLeft <= 0) {
        el.textContent = "x402 testnet mode expired — back to live Base";
        setTimeout(function () {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 4000);
        return;
      }
      el.textContent =
        "x402 DEV / testnet active · " + secondsLeft + "s left · homolog button unlocked";
    } catch (_) {
      /* sessionStorage barrado (modo privado / 3rd-party): seguir sem o ticket de dev. */
    }
  }

  function captureDevFromUrl() {
    try {
      var u = new URL(location.href);
      var t = u.searchParams.get("dev") || u.searchParams.get("x402_dev");
      if (t) {
        if (ticketStillValid(t)) {
          sessionStorage.setItem(DEV_KEY, t);
          var exp = ticketExp(t);
          if (exp != null) {
            showDevBanner(Math.max(0, exp - Math.floor(Date.now() / 1000)));
          } else {
            showDevBanner(9999);
          }
        } else {
          sessionStorage.removeItem(DEV_KEY);
          showDevBanner(0);
        }
        u.searchParams.delete("dev");
        u.searchParams.delete("x402_dev");
        var q = u.searchParams.toString();
        history.replaceState({}, "", u.pathname + (q ? "?" + q : "") + u.hash);
      } else {
        // Refresh banner if session already has a live ticket
        var cur = sessionStorage.getItem(DEV_KEY) || "";
        if (cur && ticketStillValid(cur)) {
          var e2 = ticketExp(cur);
          if (e2 != null) showDevBanner(Math.max(0, e2 - Math.floor(Date.now() / 1000)));
        } else if (cur && !ticketStillValid(cur)) {
          sessionStorage.removeItem(DEV_KEY);
        }
      }
    } catch (_) {
      /* sessionStorage barrado (modo privado / 3rd-party): seguir sem o ticket de dev. */
    }
  }

  function getDevToken() {
    try {
      var t = sessionStorage.getItem(DEV_KEY) || "";
      if (!t) return "";
      if (!ticketStillValid(t)) {
        sessionStorage.removeItem(DEV_KEY);
        showDevBanner(0);
        return "";
      }
      return t;
    } catch (_) {
      return "";
    }
  }

  function clearDevToken() {
    try {
      sessionStorage.removeItem(DEV_KEY);
    } catch (_) {
      /* sessionStorage barrado (modo privado / 3rd-party): seguir sem o ticket de dev. */
    }
  }

  /** Merge X-X402-Dev into headers when session has a still-valid ticket/token. */
  function withDevHeaders(headers) {
    var h = Object.assign({}, headers || {});
    var t = getDevToken();
    if (t) h["X-X402-Dev"] = t;
    return h;
  }

  x.captureDevFromUrl = captureDevFromUrl;
  x.getDevToken = getDevToken;
  x.clearDevToken = clearDevToken;
  x.withDevHeaders = withDevHeaders;
})(typeof window !== "undefined" ? window : globalThis);
