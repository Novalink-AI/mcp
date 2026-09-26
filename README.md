# @novalinkai/mcp

Connect Claude Code, Cursor, Antigravity, VS Code and Windsurf to [Novalink](https://novalink.live). Your coding agent can then plan AI workflows, build and test them, publish them, and wire them into your codebase.

```sh
npx @novalinkai/mcp install
```

Any package runner works:

```sh
pnpm dlx @novalinkai/mcp install
yarn dlx @novalinkai/mcp install
bunx @novalinkai/mcp install
```

The installer finds your editors, adds the Novalink MCP server (`https://api.novalink.live/mcp`) to each one, and adds the `/novalink-workflows` guide. The first time the agent uses Novalink, your browser opens so you can sign in and choose what it may do. The installer never writes secrets.

### Claude Code plugin

In Claude Code you can install Novalink as a plugin instead. It bundles the server and the skill, and updates with the plugin:

```
/plugin marketplace add Novalink-AI/mcp
/plugin install novalink@novalink
```

## What gets written

| Editor | Server config | Guide |
|---|---|---|
| Claude Code | `.mcp.json`, or `claude mcp add` for `--scope user` | `.claude/skills/novalink-workflows/SKILL.md` |
| Cursor | `.cursor/mcp.json` | `.cursor/commands/` and `.cursor/rules/` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `.agent/rules/` and `.agent/workflows/` |
| VS Code | `.vscode/mcp.json` | `.github/prompts/novalink-workflows.prompt.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/rules/` |

Existing servers in these files are kept. Files with comments are left alone, and the installer prints the entry for you to add by hand.

## Options

```
npx @novalinkai/mcp install --client claude-code,cursor   # choose editors
npx @novalinkai/mcp install --scope user                  # every project, not just this repo
npx @novalinkai/mcp install --bridge                      # connect through the local stdio bridge
npx @novalinkai/mcp install --dry-run                     # show changes only
npx @novalinkai/mcp uninstall                             # remove them again
```

## The stdio bridge

Some editors cannot sign in to a remote MCP server themselves. For those, `npx @novalinkai/mcp serve` runs locally over stdio and relays to Novalink. It runs the OAuth sign-in in your browser and keeps tokens in `~/.config/novalink/credentials.json`, which only you can read.

```sh
npx @novalinkai/mcp login    # sign in ahead of time
npx @novalinkai/mcp status
npx @novalinkai/mcp logout   # revoke and forget the tokens
```

Set `NOVALINK_MCP_URL` (or `NOVALINK_API_URL`) to point at another deployment, such as `http://localhost:8000/mcp` in development.

## Permissions

At sign-in you choose what the agent may do:

- **workflows:read**: see workflows, node types, connections and credential names.
- **workflows:write**: plan, create and edit drafts.
- **workflows:publish**: publish versions and choose the active one.
- **runs:write**: run workflows.
- **api_keys:write**: create API keys limited to chosen workflows.

To disconnect an agent at any time, go to **API keys > Connected agents** in Novalink.

Docs: https://novalink.live/developers/mcp

## Development

```sh
npm ci
npm test
npm run build
NOVALINK_MCP_URL=http://localhost:8000/mcp node dist/cli.js install --dry-run
```

The skill in `skills/novalink-workflows/SKILL.md` is the source for every editor's guide, the Claude Code plugin, and the `design_workflow` prompt the Novalink server serves.

To release, bump the version in `package.json`, `src/constants.ts` and `.claude-plugin/*.json`, then push a tag such as `v0.1.2`.

## License

MIT
