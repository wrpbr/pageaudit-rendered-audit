/**
 * x402 paywall — QR EIP-681 + preenchimento do modal.
 * Carregar ANTES de /x402-paywall.js.
 */
(function (global) {
  "use strict";

  var x = (global.__x402 = global.__x402 || {});

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Same-origin QR lib (davidshimjs API: new QRCode(el, {text, width, height})).
   * CDN path for npm "qrcode" build/ was 404 — never load that again.
   */
  function loadQrLib() {
    return new Promise(function (resolve, reject) {
      if (typeof global.QRCode === "function") return resolve(global.QRCode);
      var existing = document.querySelector('script[data-x402-qrcode="1"]');
      if (existing) {
        existing.addEventListener("load", function () {
          if (typeof global.QRCode === "function") resolve(global.QRCode);
          else reject(new Error("QRCode global missing after load"));
        });
        existing.addEventListener("error", function () {
          reject(new Error("QR library failed to load"));
        });
        return;
      }
      var s = document.createElement("script");
      s.src = "/qrcode.min.js";
      s.async = true;
      s.setAttribute("data-x402-qrcode", "1");
      s.onload = function () {
        if (typeof global.QRCode === "function") resolve(global.QRCode);
        else reject(new Error("QRCode global missing"));
      };
      s.onerror = function () {
        reject(new Error("QR library failed to load (/qrcode.min.js)"));
      };
      document.head.appendChild(s);
    });
  }

  async function renderQr(el, text) {
    if (!el) return;
    el.innerHTML = "";
    el.style.background = "#fff";
    el.style.color = "#111";
    var payload = String(text || "").trim();
    if (!payload || payload === "—") {
      el.innerHTML =
        '<p class="small mb-0 p-2" style="color:#333">' + esc(x.tx("pay.noUri", "No payment URI to encode.")) + "</p>";
      return;
    }
    try {
      var QR = await loadQrLib();
      // davidshimjs: constructor draws into the element (canvas/table/svg)
      // correctLevel L = more capacity for long EIP-681 URIs
      var level =
        QR.CorrectLevel && QR.CorrectLevel.L != null ? QR.CorrectLevel.L : 1;
      // A instancia desenha dentro de `el` ja no construtor (davidshimjs). Guardar a referencia
      // no proprio elemento da o que chamar em `.clear()` num re-render — e tira o `new` solto,
      // que era a unica razao do `eslint-disable no-new` que ficava aqui.
      el._qr = new QR(el, {
        text: payload,
        width: 168,
        height: 168,
        colorDark: "#111111",
        colorLight: "#ffffff",
        correctLevel: level,
      });
      // Ensure scannable contrast even in dark theme parent
      var canvas = el.querySelector("canvas");
      if (canvas) {
        canvas.style.display = "block";
        canvas.style.maxWidth = "100%";
      }
    } catch (err) {
      el.innerHTML =
        '<p class="small mb-0 p-2" style="color:#333">' +
        esc(
          x.tx("pay.qrFail", "QR failed: {err}. Copy the payment URI below.", {
            err: err && err.message ? err.message : String(err),
          })
        ) +
        "</p>";
    }
  }

  function applyUi(data, ctx) {
    var $ = ctx.$;
    ctx.lastAccepts = data.accepts || [];
    var quote = data.quote || {};
    ctx.lastBilling = data.billing || {};
    var lastAccepts = ctx.lastAccepts;
    var lastBilling = ctx.lastBilling;
    var devTok = x.getDevToken();
    // Session ticket wins: even if the 402 body was minted in live mode, UI is testnet.
    var inDev =
      Boolean(devTok) || Boolean(lastBilling.dev) || Boolean(lastBilling.homolog);

    var reasons = (quote.reasons || [])
      .map(function (r) {
        return (
          '<div class="d-flex align-items-start gap-2 mb-1">' +
          x.icone("bi-lock-fill", "lock") +
          "<div><strong class=\"small\">" +
          esc(r.code) +
          "</strong> — <span class=\"small text-body-secondary\">" +
          esc(r.message || "") +
          " ($" +
          Number(r.price_usd || 0).toFixed(2) +
          ")</span></div></div>"
        );
      })
      .join("") ||
      '<p class="small text-body-secondary mb-0">' +
        esc(x.tx("pay.required", "Payment required for this action.")) +
        "</p>";
    if ($("paywall-reasons")) $("paywall-reasons").innerHTML = reasons;

    var price =
      lastBilling.price_usd != null ? lastBilling.price_usd : quote.price_usd;
    if ($("paywall-price")) {
      $("paywall-price").textContent =
        price != null ? "$" + Number(price).toFixed(2) + " USDC" : "—";
    }
    if ($("paywall-network")) {
      $("paywall-network").textContent = inDev
        ? lastBilling.network && lastBilling.network !== "base"
          ? lastBilling.network
          : "base-sepolia"
        : lastBilling.network || "—";
      $("paywall-network").className = inDev
        ? "fw-semibold text-warning"
        : "fw-semibold";
    }
    if ($("paywall-payto")) {
      $("paywall-payto").textContent = lastBilling.pay_to || "—";
    }
    if ($("paywall-accepts")) {
      $("paywall-accepts").textContent = JSON.stringify(lastAccepts, null, 2);
    }

    if (ctx.modalEl) {
      ctx.modalEl.classList.toggle("paywall-is-dev", inDev);
      ctx.modalEl.classList.toggle("paywall-is-live", !inDev);
    }

    var modeBadge = $("paywall-mode-badge");
    if (modeBadge) {
      modeBadge.hidden = false;
      if (inDev) {
        modeBadge.textContent = x.tx("pay.modeDev", "DEV · Base Sepolia (testnet)");
        modeBadge.className = "badge text-bg-warning";
      } else {
        modeBadge.textContent = x.tx("pay.modeLive", "Live · Base");
        modeBadge.className = "badge text-bg-success";
      }
    }

    var subtitle = $("paywall-subtitle");
    if (subtitle) {
      subtitle.innerHTML = inDev
        ? x.tx(
            "pay.devSub",
            "<strong class=\"text-warning\">Modo testnet.</strong> Homolog simula sem gastar. Wallet de teste = USDC na <strong>Base Sepolia</strong> (não mainnet)."
          )
        : x.tx(
            "pay.liveSub",
            "Extra capacity is charged via <strong>x402</strong> (USDC on Base mainnet)."
          );
    }

    // Homolog / simulate: any valid session ticket (server still re-checks token)
    var canHomolog = Boolean(devTok) || Boolean(lastBilling.homolog);
    if ($("paywall-homolog-note")) $("paywall-homolog-note").hidden = !canHomolog;
    if ($("paywall-homolog-btn")) {
      $("paywall-homolog-btn").hidden = !canHomolog;
      $("paywall-homolog-btn").textContent = "";
      $("paywall-homolog-btn").innerHTML =
        x.icone("bi-magic", "wand") + " " + x.tx("pay.simularLong", "Simular pagamento (homolog · sem chain)");
    }
    if ($("paywall-homolog-btn-main")) {
      $("paywall-homolog-btn-main").hidden = !canHomolog;
    }

    var walletBtn = $("paywall-wallet-btn");
    if (walletBtn) {
      walletBtn.innerHTML = inDev
        ? x.icone("bi-wallet2", "money") + " " + x.tx("pay.walletDev", "Pagar USDC testnet (Connect wallet)")
        : x.icone("bi-wallet2", "money") + " " + x.tx("pay.walletLive", "Connect wallet & pay");
      walletBtn.className = inDev ? "btn btn-outline-warning btn-lg" : "btn btn-primary btn-lg";
    }

    var qrHint = $("paywall-qr-hint");
    if (qrHint) {
      qrHint.innerHTML = inDev
        ? x.tx("pay.qrDev", "Scan MetaMask / Rabby<br><strong>USDC · Base Sepolia</strong>")
        : x.tx("pay.qrLive", "Scan MetaMask / Rabby<br>(USDC on Base)");
    }

    var faucet = $("paywall-faucet");
    if (faucet) {
      if (inDev || lastBilling.faucet) {
        faucet.href = lastBilling.faucet || "https://faucet.circle.com/";
        faucet.hidden = false;
      } else {
        faucet.hidden = true;
      }
    }

    var wallets = lastBilling.wallets || {};
    if ($("paywall-link-metamask") && wallets.metamask) {
      $("paywall-link-metamask").href = wallets.metamask;
    }
    if ($("paywall-link-coinbase") && wallets.coinbase) {
      $("paywall-link-coinbase").href = wallets.coinbase;
    }
    if ($("paywall-link-base") && wallets.base_app) {
      $("paywall-link-base").href = wallets.base_app;
    }

    var eip681 =
      lastBilling.eip681 ||
      (lastAccepts[0]
        ? "ethereum:" +
          lastAccepts[0].asset +
          "@" +
          (lastBilling.chain_id || (inDev ? 84532 : 8453)) +
          "/transfer?address=" +
          lastAccepts[0].payTo +
          "&uint256=" +
          lastAccepts[0].maxAmountRequired
        : "");
    if ($("paywall-eip681")) $("paywall-eip681").textContent = eip681 || "—";
    renderQr($("paywall-qr"), eip681 || lastBilling.pay_to || "");
  }

  x.esc = esc;
  x.renderQr = renderQr;
  x.applyUi = applyUi;
})(typeof window !== "undefined" ? window : globalThis);
