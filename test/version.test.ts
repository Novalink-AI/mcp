import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { DEFAULT_URL, SERVER_NAME, VERSION } from "../src/constants.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

it("reports the version in package.json", () => {
  expect(VERSION).toBe(read("package.json").version);
});

it("keeps the Claude Code plugin in step with the package", () => {
  expect(read(".claude-plugin/plugin.json").version).toBe(VERSION);
  expect(read(".claude-plugin/marketplace.json").plugins[0].version).toBe(VERSION);
  expect(read(".mcp.json").mcpServers[SERVER_NAME].url).toBe(DEFAULT_URL);
});
