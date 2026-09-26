# Worfilo MCP

[![npm version](https://img.shields.io/npm/v/@worfilo/mcp.svg)](https://www.npmjs.com/package/@worfilo/mcp)
[![CI](https://github.com/Worfilo/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Worfilo/mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Connect coding agents to [Worfilo](https://worfilo.com) so they can design, build, test and ship AI workflows, then integrate them into your codebase.

This repository contains:

- **`@worfilo/mcp`**: a command-line tool that configures Claude Code, Cursor, Antigravity, VS Code and Windsurf to use the hosted Worfilo MCP server. It also includes a local stdio bridge for clients that cannot authenticate to remote servers.
- **The `worfilo-workflows` skill**: guidance that teaches agents the Worfilo workflow model, so the workflows they produce validate the first time.
- **A Claude Code plugin** that bundles the server configuration and the skill.

## Contents

- [What agents can do](#what-agents-can-do)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Installation options](#installation-options)
- [How it works](#how-it-works)
- [Tools](#tools)
- [Permissions](#permissions)
- [CLI reference](#cli-reference)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## What agents can do

With Worfilo connected, you can ask your agent for an automation in plain language, for example "when a support email arrives, classify it and open a Linear issue". The agent then:

1. **Discovers** the available node types and the apps, credentials, APIs and MCP servers connected to your account.
2. **Plans** a workflow graph from your description and shows you the steps before saving anything.
3. **Builds** the workflow as a draft and resolves validation issues.
4. **Tests** the draft with realistic input and repairs any failing nodes.
5. **Publishes** a version once you approve it.
6. **Integrates** it: creates an API key limited to that workflow, stores it in your environment file, and adds the API call to your code.

Every workflow created this way is a standard Worfilo workflow. You can open it on the canvas, inspect its runs, and edit it like any other.

## Requirements

- A [Worfilo](https://worfilo.com) account.
- Node.js 20 or later, for the installer and the stdio bridge.
- One or more supported clients: Claude Code, Cursor, Antigravity, VS Code (agent mode) or Windsurf.

## Quick start

Run the installer from the root of your project:

```sh
npx @worfilo/mcp install
```

The installer detects your editors, adds the Worfilo server to each one, and installs the `/worfilo-workflows` guide. It writes configuration only, never credentials, so the generated files are safe to commit.

The first time your agent calls Worfilo, a browser window opens. Sign in, review the permissions the agent is requesting, and approve. Then ask your agent to build a workflow, or invoke `/worfilo-workflows` directly.

The installer runs with any package runner:

```sh
pnpm dlx @worfilo/mcp install
yarn dlx @worfilo/mcp install
bunx @worfilo/mcp install
```

## Installation options

### Choose editors and scope

```sh
npx @worfilo/mcp install --client claude-code,cursor   # specific editors
npx @worfilo/mcp install --scope user                  # all projects, not only this repository
npx @worfilo/mcp install --dry-run                     # preview changes without writing
npx @worfilo/mcp uninstall                             # remove the configuration
```

The installer writes to these locations:

| Client | Server configuration | Guide |
|---|---|---|
| Claude Code | `.mcp.json`, or `claude mcp add` with `--scope user` | `.claude/skills/worfilo-workflows/SKILL.md` |
| Cursor | `.cursor/mcp.json` | `.cursor/commands/` and `.cursor/rules/` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `.agent/rules/` and `.agent/workflows/` |
| VS Code | `.vscode/mcp.json` | `.github/prompts/worfilo-workflows.prompt.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/rules/` |

Existing entries in these files are preserved. If a file contains comments and cannot be parsed as plain JSON, the installer leaves it unchanged and prints the entry to add manually.

### Claude Code plugin

In Claude Code, you can install Worfilo as a plugin. The plugin bundles the server configuration and the skill, and updates through the plugin system:

```
/plugin marketplace add Worfilo/mcp
/plugin install worfilo@worfilo
```

### Manual configuration

The server endpoint is `https://api.worfilo.com/mcp`, using the Streamable HTTP transport with OAuth 2.1.

Claude Code:

```sh
claude mcp add --transport http --scope user worfilo https://api.worfilo.com/mcp
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "worfilo": { "url": "https://api.worfilo.com/mcp" }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "worfilo": { "type": "http", "url": "https://api.worfilo.com/mcp" }
  }
}
```

Clients without remote OAuth support can use the stdio bridge:

```json
{
  "mcpServers": {
    "worfilo": { "command": "npx", "args": ["-y", "@worfilo/mcp@latest", "serve"] }
  }
}
```

## How it works

```
Coding agent --- MCP over HTTPS ---------------------> api.worfilo.com/mcp ---> your Worfilo account
      |                                                        ^
      +--- stdio ---> worfilo-mcp serve (local bridge) -------+
```

- **Hosted server.** Worfilo runs the MCP server. Your agent connects over HTTPS, and nothing runs on your machine besides your editor, unless you use the bridge.
- **Authentication.** The server is an OAuth 2.1 protected resource (RFC 9728).
  - Clients register dynamically (RFC 7591) and sign in with the authorization code flow and PKCE.
  - Access tokens expire after one hour and refresh automatically.
  - Refresh tokens rotate on every use. Reusing an old refresh token revokes the connection.
- **Stdio bridge.** `worfilo-mcp serve` reads JSON-RPC messages on stdin and relays them to the hosted server. It runs the OAuth flow itself through a loopback redirect and stores tokens locally.
- **Guide.** The installer puts the `worfilo-workflows` skill into each editor in that editor's native format. The server also exposes it as the `design_workflow` prompt for any MCP client.

## Tools

The agent sees only the tools allowed by the permissions you grant. Publishing, activating versions and creating API keys are marked as consequential, so clients ask for confirmation before calling them.

| Tool | Permission | Description |
|---|---|---|
| `list_node_types` | `workflows:read` | Node types available to workflow graphs |
| `get_node_type` | `workflows:read` | Ports and configuration schema for one node type |
| `list_integrations` | `workflows:read` | Connected apps and actions, credential names, custom APIs and MCP servers |
| `list_workflows` | `workflows:read` | Workflows with publish state and latest run |
| `get_workflow` | `workflows:read` | Draft graph, published versions and the active version |
| `validate_workflow` | `workflows:read` | The checks that publishing runs |
| `get_run` | `workflows:read` | Run status, output, and failing nodes |
| `get_integration_snippet` | `workflows:read` | TypeScript, JavaScript, Python or curl code for the Workflow API |
| `plan_workflow` | `workflows:write` | Drafts a graph and a readable plan without saving |
| `create_workflow` | `workflows:write` | Saves a new draft and returns validation issues |
| `update_workflow` | `workflows:write` | Replaces a draft graph and returns validation issues |
| `publish_workflow` | `workflows:publish` | Publishes the draft as a new version, optionally activating it |
| `activate_version` | `workflows:publish` | Selects the version the API runs |
| `run_workflow` | `runs:write` | Runs the draft or published version and returns the result |
| `create_api_key` | `api_keys:write` | Creates an API key limited to specific workflows |

## Permissions

You choose the permissions on the consent screen when the agent first connects.

| Scope | Allows |
|---|---|
| `workflows:read` | Reading workflows, node types, integrations and credential names. Always granted. |
| `workflows:write` | Planning, creating and editing draft workflows. |
| `workflows:publish` | Publishing versions and changing the active version. |
| `runs:write` | Running workflows and reading their results. |
| `api_keys:write` | Creating API keys restricted to chosen workflows. |

To review or revoke connected agents, open **API keys > Connected agents** in Worfilo. Revocation takes effect immediately.

## CLI reference

```
worfilo-mcp <command> [options]
```

| Command | Description |
|---|---|
| `install` | Configure detected or selected editors (the default when run in a terminal) |
| `uninstall` | Remove the configuration and guides |
| `serve` | Run the stdio bridge (the default when started by an editor) |
| `login` | Sign in for the stdio bridge ahead of time |
| `logout` | Revoke the bridge's tokens and delete them locally |
| `status` | Show the bridge's sign-in state |
| `skill` | Print the workflow guide |

| Option | Description |
|---|---|
| `--client <ids>` | Comma-separated: `claude-code`, `cursor`, `antigravity`, `vscode`, `windsurf` |
| `--scope <scope>` | `project` (default) or `user` |
| `--url <url>` | MCP server URL |
| `--bridge` | Configure editors to use the stdio bridge instead of HTTP |
| `--no-skill` | Skip installing the guide |
| `--dry-run` | Show changes without writing files |
| `--yes` | Use detected editors without prompting |

| Environment variable | Description |
|---|---|
| `WORFILO_MCP_URL` | MCP server URL, for example `http://localhost:8000/mcp` |
| `WORFILO_API_URL` | API base URL; `/mcp` is appended |
| `WORFILO_CONFIG_DIR` | Directory for the bridge's credentials file |

## Security

- The installer writes server URLs and guides only. It never writes tokens or API keys.
- The bridge stores tokens in `~/.config/worfilo/credentials.json`, or `%APPDATA%\worfilo` on Windows, readable only by your user.
- On the server, tokens are stored as SHA-256 hashes, and you can revoke any grant from your account.
- Agents are instructed to keep API keys in untracked environment files, out of source control.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Troubleshooting

**The browser did not open during sign-in.** The bridge prints the authorization URL to stderr. Open it manually.

**A configuration file was not updated.** The installer does not modify files that contain comments. Add the printed entry by hand.

**The agent reports a missing permission.** Reconnect Worfilo from your editor and grant the scope named in the message. With the bridge, run `npx @worfilo/mcp logout`, then `login`.

**Connecting to a local or self-hosted deployment.** Set `WORFILO_MCP_URL`, or pass `--url` to `install`. Server URLs must use https; plain http is accepted only for `localhost`, so tokens are never sent unencrypted.

## Development

```sh
git clone https://github.com/Worfilo/mcp.git
cd mcp
npm ci
npm test
npm run build
WORFILO_MCP_URL=http://localhost:8000/mcp node dist/cli.js install --dry-run
```

`skills/worfilo-workflows/SKILL.md` is the single source for the guide. The installer, the Claude Code plugin and the Worfilo server's `design_workflow` prompt all derive from it.

### Releasing

1. Update the version in `package.json`, `src/constants.ts`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. The test suite fails if they differ.
2. Push a matching tag, for example `v0.1.2`.

The release workflow publishes to npm through trusted publishing, with provenance.

## License

[MIT](LICENSE)
