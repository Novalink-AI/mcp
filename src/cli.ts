import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { type AuthDeps, TokenStore, defaultStorePath, login, logout } from "./auth.js";
import { serve } from "./bridge.js";
import { openBrowser } from "./browser.js";
import { CLIENTS, CLIENT_IDS, type Client, type Place, type Scope, type Step, findClient } from "./clients.js";
import { DOCS_URL, PACKAGE, SERVER_NAME, VERSION, log, serverUrl } from "./constants.js";
import { ConfigError, readJson, remove, withServer, withoutServer, writeJson, writeText } from "./files.js";
import { loadSkill } from "./skill.js";

const HELP = `${PACKAGE} ${VERSION}: connect coding agents to Worfilo

Usage
  npx ${PACKAGE} install [options]    Add Worfilo and the /worfilo-workflows guide to your editors
  npx ${PACKAGE} uninstall [options]  Remove them again
  npx ${PACKAGE} login                Sign in for the local bridge
  npx ${PACKAGE} logout               Sign out and revoke the bridge's tokens
  npx ${PACKAGE} status               Show the bridge's sign-in state
  npx ${PACKAGE} serve                Run the stdio bridge (editors start this for you)
  npx ${PACKAGE} skill                Print the workflow guide

Options
  --client <ids>   ${CLIENT_IDS.join(", ")} (comma separated; default: detected)
  --scope <scope>  project (this repo, default) or user (every project)
  --url <url>      MCP server URL (default: WORFILO_MCP_URL, WORFILO_API_URL/mcp, or production)
  --bridge         Connect through the local stdio bridge instead of over HTTP
  --no-skill       Skip the /worfilo-workflows guide
  --dry-run        Show what would change without writing anything
  --yes            Do not ask; use detected editors

Docs: ${DOCS_URL}`;

function onPath(bin: string): boolean {
  const extensions = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir && extensions.some((extension) => existsSync(join(dir, bin + extension))));
}

function authDeps(): AuthDeps {
  return { fetch: globalThis.fetch, store: new TokenStore(defaultStorePath()), open: openBrowser, log };
}

const place = (): Place => ({ cwd: process.cwd(), home: homedir(), platform: process.platform, appData: process.env.APPDATA });
const shown = (path: string) => (path.startsWith(process.cwd()) ? relative(process.cwd(), path) || "." : path.replace(homedir(), "~"));

async function chooseClients(ids: string | undefined, yes: boolean): Promise<Client[]> {
  if (ids) {
    return ids.split(",").map((id) => {
      const client = findClient(id.trim());
      if (!client) throw new Error(`Unknown client '${id}'. Choose from: ${CLIENT_IDS.join(", ")}.`);
      return client;
    });
  }
  const probe = { onPath, exists: existsSync };
  const detected = CLIENTS.filter((client) => client.detect(place(), probe));
  if (yes || !process.stdin.isTTY) {
    if (!detected.length) throw new Error(`No supported editor found. Pass --client with one of: ${CLIENT_IDS.join(", ")}.`);
    return detected;
  }
  log("Which editors should use Worfilo?");
  CLIENTS.forEach((client, index) => log(`  ${index + 1}. ${client.name}${detected.includes(client) ? " (detected)" : ""}`));
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const fallback = detected.map((client) => CLIENTS.indexOf(client) + 1).join(",");
  const answer = (await prompt.question(`Numbers, comma separated [${fallback || "1"}]: `)).trim() || fallback || "1";
  prompt.close();
  const chosen = answer
    .split(",")
    .map((part) => CLIENTS[Number(part.trim()) - 1])
    .filter((client): client is Client => Boolean(client));
  if (!chosen.length) throw new Error("No editor chosen.");
  return chosen;
}

function apply(step: Step, dryRun: boolean, undo: boolean): string | undefined {
  const prefix = dryRun ? "would " : "";
  switch (step.kind) {
    case "server": {
      try {
        const current = readJson(step.path);
        const next = undo ? withoutServer(current, step.key, SERVER_NAME) : withServer(current, step.key, SERVER_NAME, step.entry);
        if (!dryRun) writeJson(step.path, next);
        return `${prefix}${undo ? "remove" : "add"} ${SERVER_NAME} in ${shown(step.path)}`;
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        return `${error.message}. Add this under "${step.key}" by hand:\n  "${SERVER_NAME}": ${JSON.stringify(step.entry)}`;
      }
    }
    case "file": {
      if (undo) {
        const path = step.removeDir ? join(step.path, "..") : step.path;
        if (!dryRun) remove(path);
        return `${prefix}remove ${shown(path)}`;
      }
      if (!dryRun) writeText(step.path, step.content);
      return `${prefix}write ${shown(step.path)}`;
    }
    case "command": {
      const argv = undo ? step.undo : step.argv;
      const [bin, ...args] = argv;
      if (!bin || !onPath(bin)) return `run this yourself: ${argv.join(" ")}`;
      if (dryRun) return `would run: ${argv.join(" ")}`;
      const result = spawnSync(bin, args, { stdio: "inherit", shell: process.platform === "win32" });
      return result.status === 0 ? `ran: ${argv.join(" ")}` : `this failed, run it yourself: ${argv.join(" ")}`;
    }
    case "note":
      return undefined;
  }
}

async function install(values: Flags, undo: boolean): Promise<void> {
  const scope = (values.scope ?? "project") as Scope;
  if (scope !== "project" && scope !== "user") throw new Error("--scope is project or user.");
  const url = serverUrl(values.url);
  const clients = await chooseClients(values.client, Boolean(values.yes));
  const options = { url, scope, skill: loadSkill(), withSkill: !values["no-skill"], bridge: Boolean(values.bridge) };
  const notes: string[] = [];
  for (const client of clients) {
    log(`\n${client.name}`);
    for (const step of client.plan(place(), options)) {
      if (step.kind === "note") {
        if (!undo) notes.push(`${client.name}: ${step.text}`);
        continue;
      }
      const line = apply(step, Boolean(values["dry-run"]), undo);
      if (line) log(`  ${line}`);
    }
  }
  if (undo) {
    log(`\nRemoved. To revoke access too, run: npx ${PACKAGE} logout, and disconnect the agent under API keys in Worfilo.`);
    return;
  }
  log(`\nWorfilo MCP server: ${url}`);
  for (const note of notes) log(`- ${note}`);
  if (scope === "project") log("- Commit the new files to share the setup with your team; no secrets were written.");
}

type Flags = {
  client?: string;
  scope?: string;
  url?: string;
  bridge?: boolean;
  "no-skill"?: boolean;
  "dry-run"?: boolean;
  yes?: boolean;
  help?: boolean;
  version?: boolean;
};

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      client: { type: "string" },
      scope: { type: "string" },
      url: { type: "string" },
      bridge: { type: "boolean" },
      "no-skill": { type: "boolean" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    log(VERSION);
    return 0;
  }
  // editors launch the bridge with no arguments and a pipe for stdin
  const command = positionals[0] ?? (values.help ? "help" : process.stdin.isTTY ? "install" : "serve");
  const url = serverUrl(values.url);
  switch (command) {
    case "install":
    case "uninstall":
      await install(values, command === "uninstall");
      return 0;
    case "serve":
      await serve(url, authDeps());
      return 0;
    case "login": {
      const tokens = await login(url, authDeps());
      log(`Signed in to ${url} with: ${tokens.scope ?? "all permissions"}`);
      return 0;
    }
    case "logout":
      log((await logout(url, authDeps())) ? `Signed out of ${url}.` : `Not signed in to ${url}.`);
      return 0;
    case "status": {
      const tokens = new TokenStore(defaultStorePath()).get(url);
      if (!tokens.refreshToken && !tokens.accessToken) log(`Not signed in to ${url}. Run: npx ${PACKAGE} login`);
      else log(`Signed in to ${url}\nPermissions: ${tokens.scope ?? "unknown"}\nToken refreshes: ${tokens.refreshToken ? "yes" : "no"}`);
      return 0;
    }
    case "skill":
      process.stdout.write(loadSkill().raw);
      return 0;
    case "help":
      log(HELP);
      return 0;
    default:
      log(`Unknown command '${command}'.\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    log(`Error: ${error.message}`);
    process.exitCode = 1;
  },
);
