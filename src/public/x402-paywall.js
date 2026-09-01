/**
 * Shared x402 browser paywall helpers (HookPulse / PageAudit / AlertaML).
 * - Captures ?dev=<token> into sessionStorage → sends X-X402-Dev on API calls
 * - Wallet pay: injected ethereum (MetaMask / Coinbase) + EIP-3009 signTypedData_v4
 * - EIP-681 QR fallback (transfer URI)
 * - Dev homolog button only when billing.homolog is true
 *
 * Expects Bootstrap 5 modal markup with ids documented in bindPaywall().
 * Helpers: /x402-paywall-dev.js, /x402-paywall-wallet.js, /x402-paywall-qr.js.
 */
(function (global) {
  "use strict";

  var x = global.__x402 || {};

  function icone(bi, silkNome) {
    if (global.GradeUI && typeof global.GradeUI.icone === "function") return global.GradeUI.icone(silkNome);
    return '<i class="bi ' + bi + '" aria-hidden="true"></i>';
  }

  function tx(k, fb, vars) {
    if (global.GradeI18n && typeof global.GradeI18n.tx === "function") return global.GradeI18n.tx(k, fb, vars);
    if (!vars) return fb;
    return String(fb).replace(/\{(\w+)\}/g, function (_, n) {
      return vars[n] != null ? String(vars[n]) : "";
    });
  }

  x.icone = icone;
  x.tx = tx;

  /**
   * Bind modal DOM once.
   * @param {object} opts
   * @param {string} opts.modalId
   * @param {function} opts.api - (path, {method, body, headers}) => Promise<Response>
   * @param {function} [opts.onSuccess] - (data, pending) => void
   * @param {function} [opts.onError] - (err) => void
   * @param {function} [opts.bootstrapModal] - factory returning {show,hide}
   */
  function bindPaywall(opts) {
    x.captureDevFromUrl();
    var modalEl = document.getElementById(opts.modalId || "paywall-modal");
    if (!modalEl) return null;
    var modal =
      opts.bootstrapModal ||
      (global.bootstrap
        ? new global.bootstrap.Modal(modalEl)
        : { show: function () {}, hide: function () {} });

    var ctx = { lastAccepts: [], lastBilling: {}, pending: null, modalEl: modalEl };

    function $(id) {
      return document.getElementById(id);
    }
    ctx.$ = $;

    function setStatus(msg, kind) {
      var el = $("paywall-status");
      if (!el) return;
      if (!msg) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.hidden = false;
      el.className =
        "alert py-2 small mb-0 " +
        (kind === "ok" ? "alert-success" : kind === "warn" ? "alert-warning" : "alert-danger");
      el.textContent = msg;
    }

    /**
     * Show paywall. If a dev ticket is in session but the 402 was live,
     * re-request with X-X402-Dev so accepts[] switch to base-sepolia.
     */
    async function show(data, pendingReq) {
      ctx.pending = pendingReq;
      setStatus("", null);
      if (typeof opts.onBeforeShow === "function") opts.onBeforeShow();

      var devTok = x.getDevToken();
      if (devTok && pendingReq && typeof opts.api === "function") {
        var needRefresh = !(data && data.billing && (data.billing.dev || data.billing.homolog));
        if (needRefresh) {
          setStatus(tx("pay.devTicket", "Ticket dev ativo — pedindo 402 em testnet…"), "warn");
          try {
            var res = await opts.api(pendingReq.path, {
              method: pendingReq.method,
              body: pendingReq.body,
              headers: x.withDevHeaders({}),
            });
            var body = await res.json().catch(function () {
              return {};
            });
            if (res.status === 402) {
              data = body;
              setStatus(tx("pay.testnetOk", "Testnet (Base Sepolia) pronta. Use Simular ou pague com USDC de teste."), "ok");
            } else if (res.ok) {
              ctx.pending = null;
              modal.hide();
              if (opts.onSuccess) opts.onSuccess(body, pendingReq);
              return;
            } else {
              setStatus(
                tx("pay.devFail", "Dev re-request falhou ({status}). Simular ainda tenta com o ticket.", {
                  status: res.status,
                }),
                "warn"
              );
            }
          } catch (err) {
            setStatus(
              tx("pay.devRetry", "Não consegui revalidar testnet: {err}", { err: err.message || err }),
              "warn"
            );
          }
        }
      }

      x.applyUi(data || {}, ctx);
      modal.show();
    }

    async function retryWith(headers) {
      if (!ctx.pending) throw new Error(tx("pay.noPending", "No pending payment action"));
      var res = await opts.api(ctx.pending.path, {
        method: ctx.pending.method,
        body: ctx.pending.body,
        headers: x.withDevHeaders(headers || {}),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        var err = new Error(data.detail || data.error || res.statusText || tx("pay.failed", "Payment failed"));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    if ($("paywall-copy-payto")) {
      $("paywall-copy-payto").addEventListener("click", function () {
        var t = $("paywall-payto") && $("paywall-payto").textContent;
        if (t && navigator.clipboard) navigator.clipboard.writeText(t);
      });
    }
    if ($("paywall-copy-accepts")) {
      $("paywall-copy-accepts").addEventListener("click", function () {
        var t = $("paywall-accepts") && $("paywall-accepts").textContent;
        if (t && navigator.clipboard) navigator.clipboard.writeText(t);
      });
    }
    if ($("paywall-copy-eip681")) {
      $("paywall-copy-eip681").addEventListener("click", function () {
        var t = $("paywall-eip681") && $("paywall-eip681").textContent;
        if (t && navigator.clipboard) navigator.clipboard.writeText(t);
      });
    }

    if ($("paywall-wallet-btn")) {
      $("paywall-wallet-btn").addEventListener("click", async function () {
        var btn = $("paywall-wallet-btn");
        btn.disabled = true;
        setStatus(tx("pay.connectStatus", "Connect wallet and approve the USDC authorization…"), "warn");
        try {
          var req = ctx.lastAccepts[0];
          if (!req) throw new Error(tx("pay.missing", "Missing payment requirements"));
          var signed = await x.signExactPayment(req);
          setStatus(tx("pay.settling", "Settling payment…"), "warn");
          var data = await retryWith({ "X-PAYMENT": signed.header });
          modal.hide();
          ctx.pending = null;
          setStatus("", null);
          if (opts.onSuccess) opts.onSuccess(data, ctx.pending);
        } catch (err) {
          setStatus(err.message || String(err), "err");
          if (opts.onError) opts.onError(err);
        } finally {
          btn.disabled = false;
        }
      });
    }

    async function runHomolog(btn) {
      if (!x.getDevToken()) {
        setStatus(tx("pay.noDev", "Sem ticket dev. Rode npm run x402 e abra a URL."), "err");
        return;
      }
      if (btn) btn.disabled = true;
      setStatus(tx("pay.simulating", "Simulando pagamento (homolog · testnet · sem gastar USDC)…"), "warn");
      try {
        var data = await retryWith({ "X-X402-Homolog": "1" });
        modal.hide();
        ctx.pending = null;
        setStatus("", null);
        if (opts.onSuccess) opts.onSuccess(data, ctx.pending);
      } catch (err) {
        setStatus(err.message || String(err), "err");
        if (opts.onError) opts.onError(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    if ($("paywall-homolog-btn")) {
      $("paywall-homolog-btn").addEventListener("click", function () {
        runHomolog($("paywall-homolog-btn"));
      });
    }
    if ($("paywall-homolog-btn-main")) {
      $("paywall-homolog-btn-main").addEventListener("click", function () {
        runHomolog($("paywall-homolog-btn-main"));
      });
    }

    return {
      show: show,
      hide: function () {
        modal.hide();
      },
      getDevToken: x.getDevToken,
      withDevHeaders: x.withDevHeaders,
    };
  }

  x.captureDevFromUrl();

  global.X402Paywall = {
    captureDevFromUrl: x.captureDevFromUrl,
    getDevToken: x.getDevToken,
    clearDevToken: x.clearDevToken,
    withDevHeaders: x.withDevHeaders,
    signExactPayment: x.signExactPayment,
    bindPaywall: bindPaywall,
  };
})(typeof window !== "undefined" ? window : globalThis);
