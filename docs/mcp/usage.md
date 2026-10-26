# Pulse usage

You use Pulse by pointing an MCP-aware AI assistant
at it and asking questions in natural language.

## Connect your assistant

Point the assistant at your deployment's `/mcp` endpoint, or at the hosted
[playground](https://pulse-playground.miragon.ai/mcp) to try it without any
setup. The playground is public and therefore **read-only**: you can ask
anything, but it never changes the engine.

| Host               | How to connect                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| claude.ai          | Settings → Connectors → **Add custom connector**, URL `https://pulse-playground.miragon.ai/mcp` (needs a public HTTPS endpoint) |
| Claude Code        | `claude mcp add --transport http pulse https://pulse-playground.miragon.ai/mcp`                                                 |
| Claude Desktop     | stdio only: bridge the HTTP endpoint with `mcp-remote` (below)                                                                  |
| Any other MCP host | add it as a streamable-HTTP server                                                                                              |

Claude Desktop validates `claude_desktop_config.json` against the stdio shape,
so a bare `"url"` entry is dropped silently. Open Settings → Developer → Edit
Config, add the bridge, and restart the app:

```json
{
  "mcpServers": {
    "pulse": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://pulse-playground.miragon.ai/mcp",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

For a server on your own machine, use `http://127.0.0.1:8400/mcp` there:
`127.0.0.1` rather than `localhost`, which Node may resolve to IPv6 while the
server listens on IPv4.

Once connected, you'll see Camunda and analytics tools available in the
assistant. Try asking _"show me the open incidents"_. Claude calls
`camunda7_show_incidents_dashboard` and renders the result in the incidents widget.

## What you can ask

| Topic          | Example questions                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Processes**  | "Show me all process definitions." · "Start a new instance of `loan-approval`."                        |
| **Tasks**      | "What tasks are assigned to me?" · "Complete task 12345 with `approved=true`."                         |
| **Incidents**  | "Triage the open incidents." · "Retry all failed jobs from this morning."                              |
| **Analytics**  | "Where do `loan-approval` instances spend the most time?" · "Find failed instances from the last 24h." |
| **Migrations** | "Plan a migration from v1 to v2 of `loan-approval`."                                                   |

Most data-heavy answers come back as an interactive widget: process lists,
task inboxes, incident dashboards, instance details, and analytics dashboards
all render inline. Inline a widget stays a compact card: a list shows its
first rows and how many there are, and **Show all** opens it fullscreen where
your chat app offers that.

What the assistant may _change_ depends on the deployment's toolset. A
read-only deployment (the playground, or any server without login unless its
operator widened it) answers every question but offers no write tools and no
action buttons. Starting instances, completing tasks, retries and resolving
incidents need `operations` (the default with login); deletions,
modifications, migrations and signals need `admin`, which an operator has to
enable explicitly. Whether a write the assistant starts asks you first is up
to your chat app's tool-approval settings; the server marks every destructive
tool (`destructiveHint`) so the app can ask. A widget button that cancels, suspends or resolves asks first and names what
it acts on (instance, business key, engine); after any action the view reloads
what it changed: completing a task shows the next one. The cockpit's
**Refresh** re-reads the open view, e.g. after the assistant changed something.

## Your settings

Ask _"open my settings"_ (or click **Settings** in the cockpit) for the full
page: the language first, then one section per active module, so an assistant
with only some modules connected shows only those sections.

| Setting             | Section                | Effect                                                                                                   |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Language            | Language               | UI language (Automatic: the chat app's); a chosen one also sets the language tool summaries come back in |
| Engine availability | Engines and dashboards | Which engines appear in pickers, and the default the cockpit opens on                                    |
| Pinned dashboards   | Engines and dashboards | Which saved dashboards come first in pickers (needs login)                                               |
| Look-back period    | Analytics              | Applied whenever you ask an analytics question without naming a window                                   |
| Comparison bucket   | Analytics              | How many instances a window needs before a comparison is trusted                                         |

You can also open a single section (_"open my engine settings"_ or _"show my
analytics settings"_) or change a value in passing, without any page:
_"switch the UI to German"_, _"default my analytics to 30 days"_. Only the
setting you name changes; the rest keeps its value.

Settings are saved per user account, so they need a deployment with login:
signed in, they follow you across conversations. Without a login, and on a
read-only deployment, the page shows the defaults (widgets follow the chat
app's language) but hides Save. Light or dark is never a setting: the widgets
always follow the chat app's theme, and your system's without one. Saved dashboards exist only with
login on a deployment that allows writes; otherwise the dashboard picker says
"Saved dashboards are unavailable".

## Tips

- Ask follow-ups. Once a widget is on screen, you can drill down by clicking,
  or ask for "the same thing but for the last 7 days."
- Combine tools. "Find failed instances from yesterday, then retry the
  transient ones" works as a single sentence (the retry needs `operations`).
- Failed jobs and failed external tasks clear by a retry, not by marking them
  resolved: the incident views offer **Retry** for them and **Mark as
  resolved** only for custom incidents. Batch actions (batch retries,
  migrations) only queue work: ask for the batch status afterwards. Completing a task that was delegated in
  Tasklist hands it back to its owner, and the task stays open.
- The two health checks judge different things and say how: the engine
  overview rates one engine by its open incidents (by default critical at 50
  open or 25 in one cluster), the analytics health by Prometheus alert rules
  (critical only while a critical alert fires; unknown when an engine sends no
  metrics). "Has this activity failed
  before?" is answered from incident history, resolved incidents included.
- A process view counts every deployed version of its key: old versions keep
  running after a redeploy; only the diagram is one version, and it says
  which. A number the engine could not confirm shows as "—" (or "≥N" when
  only part of it was read), never as 0, and an engine that does not answer
  is an error, not an empty view.
- If a tool isn't doing what you expect, ask the assistant to show you the raw
  arguments. It'll print them, and you can spot mismatches quickly.
