const PROVIDER_API = "https://api.getsolari.com"
const CALL_TIMEOUT_MS = 15_000

export async function renderWithSandbox(target, apiKey, fetcher = globalThis.fetch.bind(globalThis)) {
  const started = Date.now()
  const session = await createSession(apiKey, fetcher)
  let client
  let targetId
  let primaryError
  try {
    client = await CdpClient.open(session.cdpEndpoint, fetcher)
    targetId = (await client.call("Target.createTarget", { url: "about:blank" })).targetId
    const attached = await client.call("Target.attachToTarget", { targetId, flatten: true })
    const channel = attached.sessionId
    let documentStatus = 0
    const stopListening = client.onEvent((message) => {
      if (message.sessionId === channel && message.method === "Network.responseReceived" && message.params?.type === "Document") {
        documentStatus = Number(message.params.response?.status) || documentStatus
      }
    })

    await Promise.all([
      client.call("Page.enable", {}, channel),
      client.call("Network.enable", {}, channel),
      client.call("Runtime.enable", {}, channel),
    ])
    const navigation = await client.call("Page.navigate", { url: target }, channel)
    if (navigation.errorText) throw new Error("The sandbox browser could not open the URL.")
    await waitForReady(client, channel)
    await waitForDomQuiet(client, channel)
    const consentClicked = Boolean(await evaluate(client, channel, consentScript()))
    if (consentClicked) await waitForDomQuiet(client, channel)
    await evaluate(client, channel, "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))", true)
    const page = await evaluate(client, channel, `({
      html: document.documentElement.outerHTML,
      url: location.href,
      status: performance.getEntriesByType('navigation')[0]?.responseStatus || 0
    })`)
    stopListening()
    if (!page?.html || !page?.url) throw new Error("The sandbox browser did not return a rendered DOM.")
    return {
      html: page.html,
      url: page.url,
      status: documentStatus || Number(page.status) || 200,
      consentClicked,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (client && targetId) await client.call("Target.closeTarget", { targetId }).catch(() => {})
    client?.close()
    try {
      await releaseSession(session.sessionId, apiKey, fetcher)
    } catch (error) {
      if (!primaryError) throw error
    }
  }
}

export class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    socket.addEventListener("message", (event) => this.receive(event.data))
    socket.addEventListener("close", () => this.failPending(new Error("The sandbox browser connection was closed.")))
    socket.addEventListener("error", () => this.failPending(new Error("The sandbox browser connection failed.")))
  }

  static async open(endpoint, fetcher) {
    const url = new URL(endpoint)
    if (url.protocol === "wss:") url.protocol = "https:"
    else if (url.protocol === "ws:") url.protocol = "http:"
    else if (!["http:", "https:"].includes(url.protocol)) throw new Error("The sandbox browser returned an invalid endpoint.")
    const response = await fetcher(url.toString(), { headers: { Upgrade: "websocket" } })
    const socket = response.webSocket
    if (!socket) throw new Error("The sandbox browser refused the connection.")
    socket.accept()
    return new CdpClient(socket)
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out in ${method}.`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  onEvent(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    try { this.socket.close(1000, "done") } catch { /* já fechou */ }
  }

  async receive(raw) {
    try {
      const text = typeof raw === "string" ? raw : raw instanceof ArrayBuffer
        ? new TextDecoder().decode(raw) : await raw.text()
      const message = JSON.parse(text)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message || "CDP error"))
        else pending.resolve(message.result || {})
        return
      }
      for (const listener of this.listeners) listener(message)
    } catch {
      this.failPending(new Error("The sandbox browser returned an invalid message."))
    }
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function createSession(apiKey, fetcher) {
  const response = await fetcher(`${PROVIDER_API}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw providerError(response.status, data.code)
  if (!data.sessionId || !(data.cdpEndpoint || data.wsEndpoint)) throw new Error("The sandbox browser returned an invalid session.")
  return {
    sessionId: data.sessionId,
    cdpEndpoint: data.cdpEndpoint || String(data.wsEndpoint).replace("/ws/", "/cdp/"),
  }
}

async function releaseSession(sessionId, apiKey, fetcher) {
  if (!sessionId) return
  const response = await fetcher(`${PROVIDER_API}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("The sandbox session could not be closed.")
}

async function waitForReady(client, channel) {
  const deadline = Date.now() + CALL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const state = await evaluate(client, channel, "document.readyState")
    if (state === "complete") return
    await wait(200)
  }
  throw new Error("The page did not finish loading in the sandbox browser.")
}

async function waitForDomQuiet(client, channel) {
  await evaluate(client, channel, `new Promise(resolve => {
    let quiet;
    const done = () => { observer.disconnect(); clearTimeout(quiet); clearTimeout(hard); resolve(true); };
    const reset = () => { clearTimeout(quiet); quiet = setTimeout(done, 450); };
    const observer = new MutationObserver(reset);
    const hard = setTimeout(done, 4000);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    reset();
  })`, true)
}

async function evaluate(client, channel, expression, awaitPromise = false) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  }, channel)
  if (result.exceptionDetails) throw new Error("The page failed while rendering.")
  return result.result?.value
}

function consentScript() {
  return `(() => {
    const accepted = /^(accept|accept all|allow all|agree|i agree|aceitar|aceitar todos|concordo|permitir todos)$/i;
    const controls = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')];
    const button = controls.find(el => accepted.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`
}

function providerError(status, code) {
  if (status === 401 || status === 403) return new Error("The sandbox credential was rejected.")
  if (status === 402) return new Error("The sandbox account is out of credits.")
  if (status === 429) return Object.assign(new Error("The sandbox browser limit is busy."), { status: 429 })
  return new Error(code ? `Sandbox verification is unavailable (${code}).` : "Sandbox verification is unavailable.")
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
