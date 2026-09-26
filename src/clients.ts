import { join } from "node:path";

import { PACKAGE, SERVER_NAME, SKILL_NAME } from "./constants.js";
import type { Json } from "./files.js";
import { type Skill, variants } from "./skill.js";

export type ClientId = "claude-code" | "cursor" | "antigravity" | "vscode" | "windsurf";
export type Scope = "project" | "user";

export interface Place {
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  appData?: string; // %APPDATA% on Windows
}

export type Step =
  | { kind: "server"; path: string; key: string; entry: Json }
  | { kind: "file"; path: string; content: string; removeDir?: boolean }
  | { kind: "command"; argv: string[]; undo: string[] }
  | { kind: "note"; text: string };

export interface Probe {
  onPath: (bin: string) => boolean;
  exists: (path: string) => boolean;
}

export interface InstallOptions {
  url: string;
  scope: Scope;
  skill: Skill;
  withSkill: boolean;
  bridge: boolean; // run through the local stdio bridge instead of connecting over HTTP
}

export interface Client {
  id: ClientId;
  name: string;
  detect: (place: Place, probe: Probe) => boolean;
  plan: (place: Place, options: InstallOptions) => Step[];
}

const bridgeEntry = (url: string): Json => ({
  command: "npx",
  args: ["-y", `${PACKAGE}@latest`, "serve", "--url", url],
});

function vscodeUserDir(place: Place): string {
  if (place.platform === "win32") return join(place.appData ?? join(place.home, "AppData", "Roaming"), "Code", "User");
  if (place.platform === "darwin") return join(place.home, "Library", "Application Support", "Code", "User");
  return join(place.home, ".config", "Code", "User");
}

const userOnly = (name: string): Step => ({
  kind: "note",
  text: `${name} reads the guide per project; run install with --scope project inside a repo to add it there.`,
});

export const CLIENTS: Client[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    detect: (place, { onPath, exists }) => onPath("claude") || exists(join(place.home, ".claude")),
    plan: (place, options) => {
      const entry = options.bridge ? bridgeEntry(options.url) : { type: "http", url: options.url };
      const steps: Step[] =
        options.scope === "project"
          ? [{ kind: "server", path: join(place.cwd, ".mcp.json"), key: "mcpServers", entry }]
          : [
              {
                kind: "command",
                argv: options.bridge
                  ? ["claude", "mcp", "add", "--scope", "user", SERVER_NAME, "--", "npx", "-y", `${PACKAGE}@latest`, "serve", "--url", options.url]
                  : ["claude", "mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, options.url],
                undo: ["claude", "mcp", "remove", "--scope", "user", SERVER_NAME],
              },
            ];
      if (options.withSkill) {
        const root = options.scope === "project" ? place.cwd : place.home;
        steps.push({
          kind: "file",
          path: join(root, ".claude", "skills", SKILL_NAME, "SKILL.md"),
          content: variants.claudeSkill(options.skill),
          removeDir: true,
        });
      }
      steps.push({ kind: "note", text: `In Claude Code, run /mcp and choose ${SERVER_NAME} to sign in. Then use /${SKILL_NAME}.` });
      return steps;
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    detect: (place, { onPath, exists }) => onPath("cursor") || exists(join(place.home, ".cursor")),
    plan: (place, options) => {
      const root = options.scope === "project" ? place.cwd : place.home;
      const entry = options.bridge ? bridgeEntry(options.url) : { url: options.url };
      const steps: Step[] = [{ kind: "server", path: join(root, ".cursor", "mcp.json"), key: "mcpServers", entry }];
      if (options.withSkill) {
        steps.push({ kind: "file", path: join(root, ".cursor", "commands", `${SKILL_NAME}.md`), content: variants.plainCommand(options.skill) });
        if (options.scope === "project") {
          steps.push({ kind: "file", path: join(root, ".cursor", "rules", `${SKILL_NAME}.mdc`), content: variants.cursorRule(options.skill) });
        }
      }
      steps.push({ kind: "note", text: `In Cursor, open Settings > MCP and select Connect on ${SERVER_NAME} to sign in. Then use /${SKILL_NAME}.` });
      return steps;
    },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    detect: (place, { onPath, exists }) => onPath("antigravity") || exists(join(place.home, ".gemini", "antigravity")),
    plan: (place, options) => {
      // the bridge signs in on first use, which works whatever remote auth the editor supports
      const entry = options.bridge ? bridgeEntry(options.url) : { serverUrl: options.url };
      const steps: Step[] = [
        { kind: "server", path: join(place.home, ".gemini", "antigravity", "mcp_config.json"), key: "mcpServers", entry },
      ];
      if (options.withSkill) {
        if (options.scope === "project") {
          steps.push(
            { kind: "file", path: join(place.cwd, ".agent", "rules", `${SKILL_NAME}.md`), content: variants.modelDecisionRule(options.skill) },
            { kind: "file", path: join(place.cwd, ".agent", "workflows", `${SKILL_NAME}.md`), content: variants.antigravityWorkflow(options.skill) },
          );
        } else {
          steps.push(userOnly("Antigravity"));
        }
      }
      steps.push({ kind: "note", text: `In Antigravity, refresh the MCP servers panel and sign in when the browser opens. Then use /${SKILL_NAME}.` });
      return steps;
    },
  },
  {
    id: "vscode",
    name: "VS Code",
    detect: (place, { onPath, exists }) => onPath("code") || exists(vscodeUserDir(place)),
    plan: (place, options) => {
      const entry = options.bridge ? { type: "stdio", ...bridgeEntry(options.url) } : { type: "http", url: options.url };
      const path = options.scope === "project" ? join(place.cwd, ".vscode", "mcp.json") : join(vscodeUserDir(place), "mcp.json");
      const steps: Step[] = [{ kind: "server", path, key: "servers", entry }];
      if (options.withSkill) {
        steps.push(
          options.scope === "project"
            ? { kind: "file", path: join(place.cwd, ".github", "prompts", `${SKILL_NAME}.prompt.md`), content: variants.vscodePrompt(options.skill) }
            : { kind: "file", path: join(vscodeUserDir(place), "prompts", `${SKILL_NAME}.prompt.md`), content: variants.vscodePrompt(options.skill) },
        );
      }
      steps.push({ kind: "note", text: `In VS Code, open mcp.json and select Start on ${SERVER_NAME} to sign in. Then use /${SKILL_NAME} in agent mode.` });
      return steps;
    },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: (place, { onPath, exists }) => onPath("windsurf") || exists(join(place.home, ".codeium", "windsurf")),
    plan: (place, options) => {
      const entry = options.bridge ? bridgeEntry(options.url) : { serverUrl: options.url };
      const steps: Step[] = [
        { kind: "server", path: join(place.home, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", entry },
      ];
      if (options.withSkill) {
        steps.push(
          options.scope === "project"
            ? { kind: "file", path: join(place.cwd, ".windsurf", "rules", `${SKILL_NAME}.md`), content: variants.modelDecisionRule(options.skill) }
            : userOnly("Windsurf"),
        );
      }
      steps.push({ kind: "note", text: `In Windsurf, refresh MCP servers in Cascade and sign in when asked.` });
      return steps;
    },
  },
];

export const CLIENT_IDS = CLIENTS.map((client) => client.id);

export function findClient(id: string): Client | undefined {
  const aliases: Record<string, ClientId> = { claude: "claude-code", code: "vscode", "vs-code": "vscode", gemini: "antigravity" };
  const wanted = aliases[id] ?? id;
  return CLIENTS.find((client) => client.id === wanted);
}
