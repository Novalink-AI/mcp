import { mkdtempSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type AuthDeps, TokenStore, accessToken, discover, pkce } from "../src/auth.js";

const URL_ = "https://api.example/mcp";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeServer(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://api.example/.well-known/oauth-protected-resource/mcp") return json({ authorization_servers: ["https://api.example"] });
    if (url === "https://api.example/.well-known/oauth-authorization-server") {
      return json({ authorization_endpoint: "https://api.example/oauth/authorize", token_endpoint: "https://api.example/oauth/token" });
    }
    if (url === "https://api.example/oauth/token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("refresh_token") === "wfr_old") return json({ access_token: "wfa_new", refresh_token: "wfr_new", expires_in: 3600 });
      return json({ error: "invalid_grant" }, 400);
    }
    return json({}, 404);
  }) as typeof fetch;
}

const deps = (store: TokenStore, calls: string[]): AuthDeps => ({ fetch: fakeServer(calls), store, open: () => undefined, log: () => undefined });
const store = () => new TokenStore(join(mkdtempSync(join(tmpdir(), "worfilo-")), "credentials.json"));

describe("auth", () => {
  it("pkce challenges are the S256 of the verifier", () => {
    const { verifier, challenge } = pkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("discovers endpoints through the resource metadata", async () => {
    const metadata = await discover(URL_, fakeServer([]));
    expect(metadata.token_endpoint).toBe("https://api.example/oauth/token");
  });

  it("stores tokens where only this user can read them", () => {
    const tokens = store();
    tokens.set(URL_, { accessToken: "wfa_x" });
    expect(statSync(tokens.path).mode & 0o777).toBe(0o600);
    expect(tokens.get(URL_).accessToken).toBe("wfa_x");
    tokens.delete(URL_);
    expect(tokens.get(URL_)).toEqual({});
  });

  it("uses a fresh token as is, and refreshes an expiring one", async () => {
    const tokens = store();
    const calls: string[] = [];
    tokens.set(URL_, { clientId: "c", accessToken: "wfa_fresh", refreshToken: "wfr_old", expiresAt: Date.now() + 3_600_000 });
    expect(await accessToken(URL_, deps(tokens, calls))).toBe("wfa_fresh");
    expect(calls).toEqual([]);

    tokens.set(URL_, { clientId: "c", accessToken: "wfa_stale", refreshToken: "wfr_old", expiresAt: Date.now() });
    expect(await accessToken(URL_, deps(tokens, calls))).toBe("wfa_new");
    expect(tokens.get(URL_).refreshToken).toBe("wfr_new");
  });

  it("drops dead tokens but keeps the client registration", async () => {
    const tokens = store();
    tokens.set(URL_, { clientId: "c", accessToken: "wfa_stale", refreshToken: "wfr_revoked", expiresAt: 0 });
    expect(await accessToken(URL_, deps(tokens, []))).toBeUndefined();
    expect(tokens.get(URL_)).toEqual({ clientId: "c" });
  });
});
