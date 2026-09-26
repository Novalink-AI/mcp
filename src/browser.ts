import { spawn } from "node:child_process";

import { checkUrl } from "./constants.js";

/** The program that opens a URL on each platform. Never a shell, so the URL cannot become a command. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  checkUrl(url, "The sign-in URL", false);
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

export function openBrowser(url: string): void {
  try {
    const [command, args] = browserCommand(url);
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // an unsafe URL is refused here; the sign-in URL is printed for the user either way
  }
}
