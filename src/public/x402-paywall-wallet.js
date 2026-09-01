/**
 * x402 paywall — carteira (chain Base + EIP-3009 signTypedData_v4).
 * Carregar ANTES de /x402-paywall.js.
 */
(function (global) {
  "use strict";

  var x = (global.__x402 = global.__x402 || {});
  var CHAIN = {
    base: { id: 8453, hex: "0x2105", name: "Base" },
    "base-sepolia": { id: 84532, hex: "0x14a34", name: "Base Sepolia" },
  };

  function b64json(obj) {
    var json = JSON.stringify(obj);
    var bytes = new TextEncoder().encode(json);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function randomNonce() {
    var a = new Uint8Array(32);
    crypto.getRandomValues(a);
    var hex = "";
    for (var i = 0; i < a.length; i++) hex += a[i].toString(16).padStart(2, "0");
    return "0x" + hex;
  }

  function provider() {
    return global.ethereum || null;
  }

  async function ensureChain(eth, network) {
    var meta = CHAIN[network] || CHAIN.base;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: meta.hex }],
      });
    } catch (err) {
      if (err && (err.code === 4902 || /unrecognized chain/i.test(String(err.message || "")))) {
        var rpc =
          network === "base-sepolia"
            ? ["https://sepolia.base.org"]
            : ["https://mainnet.base.org"];
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: meta.hex,
              chainName: meta.name,
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: rpc,
              blockExplorerUrls: [
                network === "base-sepolia"
                  ? "https://sepolia.basescan.org"
                  : "https://basescan.org",
              ],
            },
          ],
        });
      } else {
        throw err;
      }
    }
    return meta;
  }

  /**
   * Sign EIP-3009 TransferWithAuthorization for accepts[0] and return base64 X-PAYMENT.
   */
  async function signExactPayment(requirements) {
    var eth = provider();
    if (!eth) throw new Error(x.tx("pay.noWallet", "No wallet found. Install MetaMask or Coinbase Wallet."));
    var accounts = await eth.request({ method: "eth_requestAccounts" });
    var from = accounts && accounts[0];
    if (!from) throw new Error(x.tx("pay.noAccount", "Wallet did not return an account"));
    await ensureChain(eth, requirements.network);

    var value = String(requirements.maxAmountRequired);
    var now = Math.floor(Date.now() / 1000);
    var validAfter = String(now - 60);
    var validBefore = String(now + Number(requirements.maxTimeoutSeconds || 120));
    var nonce = randomNonce();
    var chainMeta = CHAIN[requirements.network] || CHAIN.base;

    var domain = {
      name: (requirements.extra && requirements.extra.name) || "USDC",
      version: (requirements.extra && requirements.extra.version) || "2",
      chainId: chainMeta.id,
      verifyingContract: requirements.asset,
    };
    var types = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    var message = {
      from: from,
      to: requirements.payTo,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
    };
    var typed = {
      types: types,
      primaryType: "TransferWithAuthorization",
      domain: domain,
      message: message,
    };
    var signature = await eth.request({
      method: "eth_signTypedData_v4",
      params: [from, JSON.stringify(typed)],
    });

    var paymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: requirements.network,
      payload: {
        signature: signature,
        authorization: {
          from: from,
          to: requirements.payTo,
          value: value,
          validAfter: validAfter,
          validBefore: validBefore,
          nonce: nonce,
        },
      },
    };
    return { header: b64json(paymentPayload), payer: from, paymentPayload: paymentPayload };
  }

  x.signExactPayment = signExactPayment;
})(typeof window !== "undefined" ? window : globalThis);
