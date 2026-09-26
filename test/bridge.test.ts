import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TokenStore } from "../src/auth.js";
import { Bridge, fromEventStream } from "../src/bridge.js";

const URL_ = "https://api.example/mcp";

function setup(answer: (auth: string, body: Record<string, unknown>) => Response) {
  const store = new TokenStore(join(mkdtempSync(join(tmpdir(), "novalink-")), "credentials.json"));
  store.set(URL_, { clientId: "c", accessToken: "nvo_a", refreshToken: "nvr_a", expiresAt: Date.now() + 3_600_000 });
  const written: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth-protected-resource")) return Response.json({ authorization_servers: ["https://api.example"] });
    if (url.includes("oauth-authorization-server")) {
      return Response.json({ authorization_endpoint: "https://api.example/oauth/authorize", token_endpoint: "https://api.example/oauth/token" });
    }
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "nvo_b", refresh_token: "nvr_b", expires_in: 3600 });
    return answer(new Headers(init?.headers).get("authorization") ?? "", JSON.parse(String(init?.body)));
  }) as typeof fetch;
  const bridge = new Bridge(URL_, { fetch: fetchFn, store, open: () => undefined, log: () => undefined }, (line) => written.push(line));
  return { bridge, written, store };
}

describe("bridge", () => {
  it("relays a request and writes the answer", async () => {
    const { bridge, written } = setup((_, body) => Response.json({ jsonrpc: "2.0", id: body.id, result: { ok: true } }));
    await bridge.relay({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(JSON.parse(written[0]!)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("stays quiet for notifications", async () => {
    const { bridge, written } = setup(() => new Response(null, { status: 202 }));
    await bridge.relay({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(written).toEqual([]);
  });

  it("refreshes once on 401 and retries", async () => {
    const { bridge, written, store } = setup((auth, body) =>
      auth === "Bearer nvo_b" ? Response.json({ jsonrpc: "2.0", id: body.id, result: {} }) : new Response(null, { status: 401 }),
    );
    await bridge.relay({ jsonrpc: "2.0", id: 7, method: "tools/list" });
    expect(JSON.parse(written[0]!).id).toBe(7);
    expect(store.get(URL_).accessToken).toBe("nvo_b");
  });

  it("answers with a JSON-RPC error when the server cannot be reached", async () => {
    const { bridge, written } = setup(() => {
      throw new Error("offline");
    });
    await bridge.relay({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(JSON.parse(written[0]!)).toMatchObject({ id: 3, error: { code: -32603 } });
  });

  it("reads messages out of an event stream", () => {
    expect(fromEventStream('event: message\ndata: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });
});
