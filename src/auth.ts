import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { VERSION, checkUrl } from "./constants.js";

export interface Tokens {
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
}

export interface Metadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
}

export interface AuthDeps {
  fetch: typeof fetch;
  store: TokenStore;
  open: (url: string) => void;
  log: (message: string) => void;
  timeoutMs?: number;
}

const REFRESH_MARGIN_MS = 60_000;

export function defaultStorePath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.NOVALINK_CONFIG_DIR) return join(env.NOVALINK_CONFIG_DIR, "credentials.json");
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "novalink", "credentials.json");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "novalink", "credentials.json");
}

/** Tokens per server URL, in a file only this user can read. */
export class TokenStore {
  constructor(readonly path: string) {}

  private readAll(): Record<string, Tokens> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, Tokens>;
    } catch {
      return {};
    }
  }

  get(url: string): Tokens {
    return this.readAll()[url] ?? {};
  }

  set(url: string, tokens: Tokens): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify({ ...this.readAll(), [url]: tokens }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600); // mode only applies on create
  }

  delete(url: string): void {
    const all = this.readAll();
    if (!(url in all)) return;
    delete all[url];
    writeFileSync(this.path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  }
}

const b64url = (buffer: Buffer) => buffer.toString("base64url");

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

async function firstJson(fetchFn: typeof fetch, urls: string[]): Promise<Record<string, unknown> | undefined> {
  for (const url of urls) {
    try {
      const response = await fetchFn(url, { headers: { Accept: "application/json" } });
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      // try the next well-known location
    }
  }
  return undefined;
}

/** RFC 9728 then RFC 8414: from the MCP URL to the authorization server's endpoints. */
export async function discover(url: string, fetchFn: typeof fetch): Promise<Metadata> {
  const resource = new URL(url);
  const path = resource.pathname === "/" ? "" : resource.pathname;
  const prm = await firstJson(fetchFn, [
    `${resource.origin}/.well-known/oauth-protected-resource${path}`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
  ]);
  const servers = prm?.authorization_servers;
  const issuer = new URL(
    checkUrl(Array.isArray(servers) && typeof servers[0] === "string" ? servers[0] : resource.origin, "The authorization server"),
  );
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const metadata = await firstJson(fetchFn, [
    `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    ...(issuerPath ? [`${issuer.origin}${issuerPath}/.well-known/oauth-authorization-server`] : []),
    `${issuer.origin}/.well-known/openid-configuration${issuerPath}`,
  ]);
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(`Could not find the sign-in endpoints for ${url}. Check the URL, or that the server is up.`);
  }
  // the server's answer decides where tokens go and what the browser opens, so it gets the same checks as the URL itself
  for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    const value = metadata[key];
    if (value !== undefined) checkUrl(String(value), `The server's ${key}`);
  }
  return metadata as unknown as Metadata;
}

async function postForm(fetchFn: typeof fetch, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.error_description ?? body.error ?? `sign-in failed with ${response.status}`));
  }
  return body;
}

function toTokens(clientId: string, body: Record<string, unknown>): Tokens {
  return {
    clientId,
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    scope: body.scope ? String(body.scope) : undefined,
  };
}

const DONE_PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Novalink</title><body style="font:16px system-ui;padding:3rem;max-width:32rem;margin:auto"><h1 style="font-size:1.25rem">${message}</h1><p>You can close this tab and return to your editor.</p></body>`;

/** The authorization code flow with PKCE, finished on a loopback port (RFC 8252). */
export async function login(url: string, deps: AuthDeps): Promise<Tokens> {
  const metadata = await discover(url, deps.fetch);
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(16));

  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const received = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  const server = createServer((request, response) => {
    const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
    if (!request.url?.startsWith("/callback")) {
      response.writeHead(404).end();
      return;
    }
    const error = query.get("error");
    const ok = !error && query.get("state") === state && query.get("code");
    response.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    response.end(DONE_PAGE(ok ? "Novalink is connected" : "Novalink was not connected"));
    if (error) settle?.reject(new Error(query.get("error_description") ?? error));
    else if (query.get("state") !== state) settle?.reject(new Error("The sign-in response did not match this request."));
    else settle?.resolve(query.get("code") ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/callback`;

  try {
    let clientId = deps.store.get(url).clientId;
    if (!clientId) {
      if (!metadata.registration_endpoint) throw new Error("This server does not support client registration.");
      const response = await deps.fetch(metadata.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_name: `Novalink MCP CLI ${VERSION}`,
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body.error_description ?? "client registration failed"));
      clientId = String(body.client_id);
    }

    const authorize = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      resource: url,
    })) {
      authorize.searchParams.set(key, value);
    }
    deps.log(`Opening your browser to sign in to Novalink. If it does not open, visit:\n${authorize.toString()}`);
    deps.open(authorize.toString());

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for sign-in.")), deps.timeoutMs ?? 5 * 60_000).unref(),
    );
    const code = await Promise.race([received, timeout]);
    const tokens = toTokens(
      clientId,
      await postForm(deps.fetch, metadata.token_endpoint, {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: url,
      }),
    );
    deps.store.set(url, tokens);
    return tokens;
  } finally {
    server.close();
  }
}

export async function refresh(url: string, deps: AuthDeps): Promise<Tokens | undefined> {
  const stored = deps.store.get(url);
  if (!stored.refreshToken || !stored.clientId) return undefined;
  try {
    const metadata = await discover(url, deps.fetch);
    const tokens = toTokens(
      stored.clientId,
      await postForm(deps.fetch, metadata.token_endpoint, {
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: stored.clientId,
        resource: url,
      }),
    );
    deps.store.set(url, tokens);
    return tokens;
  } catch (error) {
    deps.log(`Could not refresh the Novalink session: ${(error as Error).message}`);
    deps.store.set(url, { clientId: stored.clientId }); // keep the registration, drop the dead tokens
    return undefined;
  }
}

/** A live access token: the stored one, a refreshed one, or undefined when sign-in is needed. */
export async function accessToken(url: string, deps: AuthDeps): Promise<string | undefined> {
  const stored = deps.store.get(url);
  if (stored.accessToken && (stored.expiresAt ?? 0) - REFRESH_MARGIN_MS > Date.now()) return stored.accessToken;
  return (await refresh(url, deps))?.accessToken;
}

export async function logout(url: string, deps: AuthDeps): Promise<boolean> {
  const stored = deps.store.get(url);
  const token = stored.refreshToken ?? stored.accessToken;
  if (token) {
    try {
      const metadata = await discover(url, deps.fetch);
      if (metadata.revocation_endpoint) await postForm(deps.fetch, metadata.revocation_endpoint, { token });
    } catch {
      // the local tokens go either way
    }
  }
  deps.store.delete(url);
  return Boolean(token);
}
