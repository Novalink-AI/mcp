import { createInterface } from "node:readline";

import { type AuthDeps, accessToken, login, refresh } from "./auth.js";

type Message = { jsonrpc: "2.0"; id?: string | number | null; method?: string; [key: string]: unknown };

/** Relays newline-delimited JSON-RPC from stdio to the hosted server, signing in when needed. */
export class Bridge {
  private signingIn: Promise<unknown> | undefined;
  private protocolVersion: string | undefined;

  constructor(
    private readonly url: string,
    private readonly deps: AuthDeps,
    private readonly write: (line: string) => void,
  ) {}

  private async token(): Promise<string> {
    const token = await accessToken(this.url, this.deps);
    if (token) return token;
    // one browser sign-in, however many requests arrive while it is open
    this.signingIn ??= login(this.url, this.deps).finally(() => (this.signingIn = undefined));
    await this.signingIn;
    return (await accessToken(this.url, this.deps)) ?? "";
  }

  private post(message: Message, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    };
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    return this.deps.fetch(this.url, { method: "POST", headers, body: JSON.stringify(message) });
  }

  async relay(message: Message): Promise<void> {
    const expectsAnswer = message.method !== undefined && message.id !== undefined && message.id !== null;
    try {
      let response = await this.post(message, await this.token());
      if (response.status === 401) {
        const renewed = (await refresh(this.url, this.deps))?.accessToken ?? (await this.token());
        response = await this.post(message, renewed);
      }
      if (response.status === 202 || !expectsAnswer) return;
      const type = response.headers.get("content-type") ?? "";
      const text = await response.text();
      const answers = type.includes("text/event-stream") ? fromEventStream(text) : [text];
      for (const answer of answers) {
        if (message.method === "initialize") this.rememberVersion(answer);
        this.write(answer);
      }
      if (!answers.length) this.fail(message, `Novalink answered ${response.status} with no body.`);
    } catch (error) {
      if (expectsAnswer) this.fail(message, (error as Error).message);
    }
  }

  private rememberVersion(answer: string): void {
    try {
      this.protocolVersion = (JSON.parse(answer) as { result?: { protocolVersion?: string } }).result?.protocolVersion;
    } catch {
      // not our concern if the answer is malformed; the client will say so
    }
  }

  private fail(message: Message, detail: string): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: `Novalink: ${detail}` } }));
  }
}

export function fromEventStream(text: string): string[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
}

export async function serve(url: string, deps: AuthDeps): Promise<void> {
  const bridge = new Bridge(url, deps, (line) => process.stdout.write(`${line}\n`));
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      deps.log("Ignored a line that is not JSON.");
      continue;
    }
    const task = bridge.relay(message).finally(() => pending.delete(task));
    pending.add(task);
  }
  await Promise.all(pending);
}
