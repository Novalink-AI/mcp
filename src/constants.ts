export const PACKAGE = "@worfilo/mcp";
export const VERSION = "0.2.0";
export const SERVER_NAME = "worfilo";
export const SKILL_NAME = "worfilo-workflows";
export const DEFAULT_URL = "https://api.worfilo.com/mcp";
export const DOCS_URL = "https://worfilo.com/developers/mcp";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// characters a shell or cmd.exe would act on; no MCP or sign-in URL needs them
const SHELL_UNSAFE = /[\s"'`^|<>&;$\\]/;

/**
 * Throws unless `value` is an https URL, or http on this machine, with no characters a shell would act on.
 * `strict` checks the query too; otherwise it may carry encoded parameters joined by `&`.
 */
export function checkUrl(value: string, what = "URL", strict = true): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} is not a valid URL: ${value}`);
  }
  const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${what} must use https (http is allowed only for localhost): ${value}`);
  }
  if (url.username || url.password) throw new Error(`${what} must not contain credentials: ${value}`);
  // the raw value, since that is what reaches the shell or browser
  const checked = strict ? value : (value.split(/[?#]/)[0] ?? "");
  if (SHELL_UNSAFE.test(checked)) throw new Error(`${what} contains characters that are not allowed: ${value}`);
  return value;
}

/** The MCP endpoint: --url, then WORFILO_MCP_URL, then WORFILO_API_URL plus /mcp, then production. */
export function serverUrl(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  let url = DEFAULT_URL;
  if (flag) url = flag.replace(/\/$/, "");
  else if (env.WORFILO_MCP_URL) url = env.WORFILO_MCP_URL.replace(/\/$/, "");
  else if (env.WORFILO_API_URL) url = `${env.WORFILO_API_URL.replace(/\/$/, "")}/mcp`;
  // strict: install hands it to a shell on Windows, and the bridge sends tokens to it
  return checkUrl(url, "The Worfilo server URL");
}

/** Log to stderr: in bridge mode stdout carries the protocol. */
export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}
