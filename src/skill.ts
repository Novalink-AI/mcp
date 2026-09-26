import { readFileSync } from "node:fs";

export interface Skill {
  name: string;
  description: string;
  body: string;
  raw: string;
}

export function parseSkill(raw: string): Skill {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1] ?? "")?.[1]?.trim() ?? "";
  return { name: field("name"), description: field("description"), body: match[2] ?? "", raw };
}

// resolves from dist/cli.js and from src/ alike, since both sit one level below the package root
export function loadSkill(): Skill {
  return parseSkill(readFileSync(new URL("../skills/novalink-workflows/SKILL.md", import.meta.url), "utf8"));
}

const frontmatter = (fields: Record<string, string | boolean>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`)
    .join("\n")}\n---\n\n`;

/** The same guide, dressed for each editor's rule, command or prompt format. */
export const variants = {
  claudeSkill: (skill: Skill) => skill.raw,
  cursorRule: (skill: Skill) => frontmatter({ description: skill.description, alwaysApply: false }) + skill.body,
  plainCommand: (skill: Skill) => skill.body,
  modelDecisionRule: (skill: Skill) => frontmatter({ trigger: "model_decision", description: skill.description }) + skill.body,
  antigravityWorkflow: (skill: Skill) => frontmatter({ description: skill.description }) + skill.body,
  vscodePrompt: (skill: Skill) => frontmatter({ description: skill.description, mode: "agent" }) + skill.body,
};
