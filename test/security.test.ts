import { describe, expect, it } from "vitest";

import { discover } from "../src/auth.js";
import { browserCommand } from "../src/browser.js";
import { checkUrl, serverUrl } from "../src/constants.js";

describe("server URLs", () => {
  it("accepts https anywhere and http only on this machine", () => {
    expect(serverUrl("https://api.novalink.live/mcp/")).toBe("https://api.novalink.live/mcp");
    expect(serverUrl(undefined, { NOVALINK_MCP_URL: "http://localhost:8000/mcp" })).toBe("http://localhost:8000/mcp");
    expect(serverUrl(undefined, { NOVALINK_API_URL: "http://127.0.0.1:8000" })).toBe("http://127.0.0.1:8000/mcp");
    expect(() => serverUrl("http://api.example.com/mcp")).toThrow(/https/);
    expect(() => serverUrl("ftp://api.example.com/mcp")).toThrow(/https/);
    expect(() => serverUrl("not a url")).toThrow(/valid URL/);
  });

  it("refuses characters a shell would act on, and credentials", () => {
    for (const url of ["https://x.example/mcp&calc", "https://x.example/a|b", "https://x.example/$(id)", "https://x.example/a b"]) {
      expect(() => serverUrl(url)).toThrow();
    }
    expect(() => serverUrl("https://user:pass@x.example/mcp")).toThrow(/credentials/);
  });

  it("lets a sign-in URL carry an encoded query, but not a hostile path", () => {
    expect(checkUrl("https://x.example/oauth/authorize?a=1&b=%7C", "URL", false)).toBeTruthy();
    expect(() => checkUrl("https://x.example/a|calc?a=1", "URL", false)).toThrow();
  });
});

describe("opening the browser", () => {
  const url = "https://api.novalink.live/oauth/authorize?client_id=c&state=s";

  it("never goes through a shell", () => {
    expect(browserCommand(url, "win32")).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
    expect(browserCommand(url, "darwin")).toEqual(["open", [url]]);
    expect(browserCommand(url, "linux")).toEqual(["xdg-open", [url]]);
  });

  it("refuses URLs that are not safe to open", () => {
    expect(() => browserCommand("https://evil.example/a|calc", "win32")).toThrow();
    expect(() => browserCommand("http://evil.example/login", "win32")).toThrow(/https/);
    expect(() => browserCommand("file:///etc/passwd", "linux")).toThrow();
  });
});

describe("server metadata", () => {
  const serve = (metadata: Record<string, unknown>) =>
    (async (input: string | URL | Request) =>
      String(input).includes("oauth-protected-resource")
        ? Response.json({ authorization_servers: ["https://api.example"] })
        : Response.json(metadata)) as typeof fetch;

  it("rejects endpoints that would send tokens in the clear or inject commands", async () => {
    await expect(
      discover("https://api.example/mcp", serve({ authorization_endpoint: "https://api.example/a", token_endpoint: "http://evil.example/t" })),
    ).rejects.toThrow(/token_endpoint/);
    await expect(
      discover("https://api.example/mcp", serve({ authorization_endpoint: "https://api.example/a|calc", token_endpoint: "https://api.example/t" })),
    ).rejects.toThrow(/authorization_endpoint/);
  });
});
