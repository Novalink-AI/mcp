export const PACKAGE = "@novalinkai/mcp";
export const VERSION = "0.1.1";
export const SERVER_NAME = "novalink";
export const SKILL_NAME = "novalink-workflows";
export const DEFAULT_URL = "https://api.novalink.live/mcp";
export const DOCS_URL = "https://novalink.live/developers/mcp";

/** The MCP endpoint: --url, then NOVALINK_MCP_URL, then NOVALINK_API_URL plus /mcp, then production. */
export function serverUrl(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (flag) return flag.replace(/\/$/, "");
  if (env.NOVALINK_MCP_URL) return env.NOVALINK_MCP_URL.replace(/\/$/, "");
  if (env.NOVALINK_API_URL) return `${env.NOVALINK_API_URL.replace(/\/$/, "")}/mcp`;
  return DEFAULT_URL;
}

/** Log to stderr: in bridge mode stdout carries the protocol. */
export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}
