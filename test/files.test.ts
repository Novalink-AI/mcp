import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, readJson, withServer, withoutServer, writeJson } from "../src/files.js";

describe("config files", () => {
  it("adds a server without touching the others", () => {
    const before = { mcpServers: { github: { url: "https://gh" } }, theme: "dark" };
    const after = withServer(before, "mcpServers", "novalink", { url: "https://nl" });
    expect(after).toEqual({ mcpServers: { github: { url: "https://gh" }, novalink: { url: "https://nl" } }, theme: "dark" });
    expect(withoutServer(after, "mcpServers", "novalink")).toEqual(before);
  });

  it("reads missing and empty files as empty, and refuses JSON with comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "novalink-"));
    expect(readJson(join(dir, "missing.json"))).toEqual({});
    writeFileSync(join(dir, "empty.json"), "  ");
    expect(readJson(join(dir, "empty.json"))).toEqual({});
    writeFileSync(join(dir, "commented.json"), '{ // keep me\n "servers": {} }');
    expect(() => readJson(join(dir, "commented.json"))).toThrow(ConfigError);
  });

  it("writes nested paths with a trailing newline", () => {
    const path = join(mkdtempSync(join(tmpdir(), "novalink-")), "a", "b", "mcp.json");
    writeJson(path, { servers: {} });
    expect(readFileSync(path, "utf8")).toBe('{\n  "servers": {}\n}\n');
  });
});
