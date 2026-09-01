import test from "node:test";
import assert from "node:assert/strict";

import { CdpClient } from "../src/sandbox-browser.js";

test("CDP opens the remote WebSocket through an HTTP upgrade", async () => {
  let fetched;
  const socket = {
    accepted: false,
    addEventListener() {},
    accept() { this.accepted = true; },
    close() {},
  };
  const client = await CdpClient.open("wss://browser.example/cdp/session", async (url, init) => {
    fetched = { url, init };
    return { webSocket: socket };
  });

  assert.equal(fetched.url, "https://browser.example/cdp/session");
  assert.equal(fetched.init.headers.Upgrade, "websocket");
  assert.equal(socket.accepted, true);
  client.close();
});
