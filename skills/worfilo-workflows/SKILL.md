---
name: worfilo-workflows
description: Plan, build, test, publish and integrate Worfilo AI workflows into this codebase through the Worfilo MCP server. Use when the user wants to automate a task, build an AI agent workflow, or call a Worfilo workflow from their code.
---

# Building Worfilo workflows

Worfilo runs AI agent workflows: a trigger, then nodes (agents, app actions, HTTP calls, logic) joined by edges. You build them through the Worfilo MCP tools, then call them from the user's code through the public API.

## Procedure

1. **Understand the goal.** Ask what should start the workflow, what it must produce, and which apps it touches. Read the codebase to see where it will be called from and what input it can send.
2. **Discover.** Call `list_integrations` to see connected apps, credentials, custom APIs and MCP servers. Call `list_node_types`, then `get_node_type` for each type you plan to use. Never invent node types, ports or config fields.
3. **Plan.** Call `plan_workflow` with a precise description. It drafts a graph from the account's real integrations. Show the user the `steps` in plain words and agree on changes before saving. For revisions, pass `previous_graph` and an `instruction`.
4. **Create.** Call `create_workflow` with the agreed graph. Fix every `error` in `issues` with `update_workflow` (it replaces the whole draft graph). Warnings do not block.
5. **Test.** Call `run_workflow` on the draft with a realistic `input`. If it fails, read `failed_nodes`, fix the graph, and run again. Runs can call real apps and spend tokens, so say what a test run will do first.
6. **Publish.** Ask the user, then call `publish_workflow`. It activates the new version by default, which is what the API runs.
7. **Integrate.**
   - Call `create_api_key` scoped to this workflow only, and write the key to an untracked env file as `WORFILO_API_KEY`. Check `.gitignore` covers it, and never print the key back or commit it.
   - Call `get_integration_snippet` in the codebase's language, then adapt it to the project's HTTP client, types, config loading and error handling.
   - Handle both answers: 200 means finished, and 202 means poll `status_url`.
8. **Hand over.** Tell the user the workflow name, the `editor_url`, where the call site lives, and which env var to set in each deployment.

## The graph

```json
{
  "schema_version": 1,
  "nodes": [
    {"id": "trigger", "type": "manual_trigger", "name": "Trigger", "position": {"x": 0, "y": 0},
     "config": {"test_payload": {"message": "Summarise this"}}},
    {"id": "summarise", "type": "agent", "name": "Summarise", "position": {"x": 260, "y": 0},
     "config": {"credential_id": "<an anthropic credential_id>", "model": "claude-haiku-4-5-20251001",
                "user_prompt": "Summarise: {{ trigger.message }}"}},
    {"id": "result", "type": "output", "name": "Result", "position": {"x": 520, "y": 0},
     "config": {"value": "{{ nodes.summarise.output.text }}"}}
  ],
  "edges": [
    {"id": "e1", "source": "trigger", "target": "summarise"},
    {"id": "e2", "source": "summarise", "target": "result"}
  ],
  "settings": {}
}
```

The example shows the shape only. Take each node's exact config fields from `get_node_type`.

## Rules

- **Trigger.** Exactly one trigger node. Use `manual_trigger` for workflows called from code through the API, with a realistic `config.test_payload`. `webhook_trigger` and `schedule_trigger` exist for other starts.
- **Ids and names.** Node ids are unique lowercase slugs matching `^[a-z][a-z0-9_]*$`. Names are short Title Case labels.
- **Config.** Every config must satisfy its node type's `config_schema`, required fields included.
- **Edges.** An edge goes from an output port to an input port. Omit ports for the defaults (`out` to `in`).
- **Branching.**
  - An `if` node fires `true` or `false`; connect each branch with `source_port` set to that name.
  - A `switch` node's `config.cases` each name a port, plus `default`.
  - When branches rejoin, route them through a `merge` node.
- **Flow.** Data flows forward only: no cycles, and every node is reachable from the trigger. End with an `output` node, whose value is what the API returns.
- **Templates.**
  - `{{ trigger.<field> }}` reads the trigger payload. `{{ nodes.<id>.output.<field> }}` reads an upstream node, and only upstream nodes may be referenced.
  - `if` and `switch` expressions are bare, without braces, e.g. `nodes.classify.output.structured.urgency == 'high'`.
- **Agents.**
  - Set `credential_id` to an `anthropic` credential from `list_integrations`.
  - An agent's output has `.text`, and `.structured` when `config.output_schema` is set. Set `output_schema` whenever later nodes branch on the answer.
  - Use `claude-haiku-4-5-20251001` unless the task needs deeper reasoning, then `claude-sonnet-5`.
- **Apps.**
  - GitHub, Slack, Notion, Linear and Tavily use a `connector_action` node with `connector_id`, `action` and `args`. Set `connection_id` from `list_integrations`, and prefer it over `http_request`.
  - The user's own APIs use `api_request` with `api_id`, `endpoint` and `args`. Their MCP servers use `mcp_tool`.
- **Tools for agents.** An `http_request`, `connector_action` or `api_request` node can be attached to an agent with an edge of `kind: "tool"` and `target_port: "tools"`. A tool node has no other edges.
- **Secrets.** Never put keys or tokens in a graph. Reference stored credentials and connections by id. If one is missing, send the user to `connect_more` from `list_integrations`.
- **Size.** Prefer a few well-chosen nodes over many.

## Guardrails

- Confirm the plan before `create_workflow`, and ask before `publish_workflow`, `activate_version` and `create_api_key`.
- Edit drafts freely. Published versions change only when you publish again.
- Keep API keys out of source control, logs and chat.
- If a tool says a permission was not granted, ask the user to reconnect Worfilo and allow it.
