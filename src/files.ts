import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Json = Record<string, unknown>;

export class ConfigError extends Error {}

export function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
  } catch {
    // fall through: JSON with comments or a broken file is left for a person to edit
  }
  throw new ConfigError(`${path} is not plain JSON, so it was left untouched`);
}

/** Adds or replaces one server entry, keeping every other server and setting as it was. */
export function withServer(config: Json, key: string, name: string, entry: Json): Json {
  const servers = config[key] && typeof config[key] === "object" ? (config[key] as Json) : {};
  return { ...config, [key]: { ...servers, [name]: entry } };
}

export function withoutServer(config: Json, key: string, name: string): Json {
  const servers = config[key] && typeof config[key] === "object" ? { ...(config[key] as Json) } : {};
  delete servers[name];
  return { ...config, [key]: servers };
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function writeJson(path: string, value: Json): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function remove(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}
