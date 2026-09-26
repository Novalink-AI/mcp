import { describe, expect, it } from "vitest";

import { CLIENTS, type InstallOptions, type Place, findClient } from "../src/clients.js";
import { loadSkill } from "../src/skill.js";

const place: Place = { cwd: "/repo", home: "/home/ada", platform: "linux" };
const options: InstallOptions = { url: "https://api.example/mcp", scope: "project", skill: loadSkill(), withSkill: true, bridge: false };

const plan = (id: string, overrides: Partial<InstallOptions> = {}) => findClient(id)!.plan(place, { ...options, ...overrides });
const paths = (id: string, overrides: Partial<InstallOptions> = {}) =>
  plan(id, overrides).flatMap((step) => ("path" in step ? [step.path] : []));

describe("client plans", () => {
  it("claude code: project config, a skill, and the CLI for user scope", () => {
    expect(paths("claude-code")).toEqual(["/repo/.mcp.json", "/repo/.claude/skills/worfilo-workflows/SKILL.md"]);
    expect(plan("claude-code")[0]).toMatchObject({ key: "mcpServers", entry: { type: "http", url: options.url } });
    const user = plan("claude-code", { scope: "user" });
    expect(user[0]).toMatchObject({ kind: "command", argv: ["claude", "mcp", "add", "--transport", "http", "--scope", "user", "worfilo", options.url] });
    expect(paths("claude-code", { scope: "user" })).toEqual(["/home/ada/.claude/skills/worfilo-workflows/SKILL.md"]);
  });

  it("cursor: mcp.json, a slash command and a rule", () => {
    expect(paths("cursor")).toEqual([
      "/repo/.cursor/mcp.json",
      "/repo/.cursor/commands/worfilo-workflows.md",
      "/repo/.cursor/rules/worfilo-workflows.mdc",
    ]);
    expect(plan("cursor")[0]).toMatchObject({ entry: { url: options.url } });
  });

  it("antigravity and windsurf keep servers in the home directory", () => {
    expect(paths("antigravity")[0]).toBe("/home/ada/.gemini/antigravity/mcp_config.json");
    expect(plan("antigravity")[0]).toMatchObject({ entry: { serverUrl: options.url } });
    expect(paths("antigravity")).toContain("/repo/.agent/workflows/worfilo-workflows.md");
    expect(paths("windsurf")[0]).toBe("/home/ada/.codeium/windsurf/mcp_config.json");
  });

  it("vs code uses the servers key and a prompt file", () => {
    expect(plan("vscode")[0]).toMatchObject({ path: "/repo/.vscode/mcp.json", key: "servers", entry: { type: "http" } });
    expect(paths("vscode")).toContain("/repo/.github/prompts/worfilo-workflows.prompt.md");
    expect(paths("vscode", { scope: "user" })[0]).toBe("/home/ada/.config/Code/User/mcp.json");
  });

  it("the bridge runs the package over stdio", () => {
    expect(plan("cursor", { bridge: true })[0]).toMatchObject({
      entry: { command: "npx", args: ["-y", "@worfilo/mcp@latest", "serve", "--url", options.url] },
    });
  });

  it("--no-skill writes only the server config", () => {
    for (const client of CLIENTS) {
      expect(paths(client.id, { withSkill: false })).toHaveLength(1);
    }
  });

  it("detects editors from their home folders", () => {
    const probe = { onPath: () => false, exists: (path: string) => path === "/home/ada/.cursor" };
    expect(CLIENTS.filter((client) => client.detect(place, probe)).map((client) => client.id)).toEqual(["cursor"]);
    expect(findClient("claude")?.id).toBe("claude-code");
  });

  it("dresses the guide for each format", () => {
    const rule = plan("cursor").find((step) => "path" in step && step.path.endsWith(".mdc"));
    expect(rule && "content" in rule && rule.content).toMatch(/^---\ndescription: ".+"\nalwaysApply: false\n---\n\n# Building Worfilo workflows/);
  });
});
