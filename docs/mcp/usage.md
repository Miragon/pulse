# Pulse usage

You use Pulse by pointing an MCP-aware AI assistant at it and asking questions in natural language.

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

For a server on your own machine, use `http://127.0.0.1:8400/mcp` there: `127.0.0.1` rather than
`localhost`, which Node may resolve to IPv6 while the server listens on IPv4.

Once connected, you'll see the Camunda tools available in the
assistant. Try asking _"show me the open incidents"_. Claude calls
`engine_open_cockpit` on its incidents view and shows the cockpit there.

## What you can ask

| Topic          | Example questions                                                               |
| -------------- | ------------------------------------------------------------------------------- |
| **Processes**  | "Show me all process definitions." · "Start a new instance of `loan-approval`." |
| **Tasks**      | "What tasks are assigned to me?" · "Complete task 12345 with `approved=true`."  |
| **Incidents**  | "Triage the open incidents." · "Retry all failed jobs from this morning."       |
| **Diagnosis**  | "Where does order B-1 wait, and why?" · "How is the engine doing right now?"    |
| **Migrations** | "Plan a migration from v1 to v2 of `loan-approval`."                            |

Most data-heavy answers come back as an interactive view: the engine
operations cockpit (opened on its overview, the incidents, a process, an
instance, an incident, the jobs or an instance's history, then navigated by
clicking) renders inline. Its head switches between the overview, the
incidents and the jobs, or leads back along the way you came; under it each
view has one bar with what it shows, its facts and its actions, and a notice
docks under that bar when a refresh fails, the engine's own words under its
**Details**. A row of a table opens what it names on a click or Enter (Ctrl or Cmd+C copies its
ID, a board's incident row its message), as in Pulse for VS Code; its other actions sit at its end. Inline a view stays a compact card:
a list shows its first rows and how many there are, and **Show all** opens it fullscreen where your
chat app offers that.

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

## Language and theme

The widgets speak German when your chat app's language is German, and
English otherwise. Light or dark follows the chat app's theme, and your
system's without one, the process diagrams included. The tool results the
assistant reads are English; it still answers you in your language.

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
- An engine has one live verdict: the engine overview and `engine_status` rate it ok, warning or
  critical (by default critical at 50 open root incidents, never a call activity's copy, or 25 of
  one cause) and count one cause alike (activity, type, masked message); `engine_status` also judges
  overdue jobs, workers and batches. Incident history, resolved ones included, answers "has this
  activity failed before?".
- Camunda 7 copies an incident of a called instance to each call activity above it, without a
  message. "Incidents" are open root incidents on every view, as in the web app and Pulse for VS
  Code: a copy counts in the called process, never twice, and is no row of a process, an activity
  or a cause; a diagram shows the incidents of an element's called instances apart, a quiet badge.
  An instance's copy row stands for its root: its message, `in <element> · <id>` (the called
  instance), and the row opens the root; **Open cause** leads on from a copy, **Open instance** to
  an incident's instance, a called instance's caller id to its caller. New incidents count for the
  last hour alone (Camunda 7 counts none in a window): the overview's where its newest incidents
  read hold the hour, a cluster's "—" where it cannot tell.
- A process view counts every deployed version of its key: old versions keep running after a redeploy;
  only the diagram is one version, and it says which. Its flow shows the open root incidents per
  element or, under **Running**, how many instances are at each element now, its root incidents and
  apart the incidents of the instances it called, counted as the web app's process screen counts a
  version (the server keeps them 30 seconds per user). **Throughput · 30 days** colours each element
  by how often the instances started in the last 30 days passed it (the ones still there count as
  running), read from the engine's history (history level `activity` or higher): instances started
  earlier count nowhere, and a shorter history time to live shortens the window, which the view then
  says. The first open per hour reads the engine's database, so it can take seconds; the server keeps
  the read for an hour. With two engines or more, the cross-engine overview shows each engine's health
  and job backlog and which processes run where, counted on every engine, never ranked. A number the
  engine could not confirm shows as "—" (or "≥N" when only part of it was read), never as 0, and an
  engine that does not answer is an error, not an empty view.
- An instance's view names the element of each open incident (its name in the diagram, else its
  id), shows its open incidents beside its state in its bar, and leads to its process with **View
  process**. The instance list's scopes (**All**, **With incident**, **Suspended**) count what each
  one shows within the search, whichever scope is picked. **With incident** is an instance with an
  open incident now, read from the engine's runtime on every history level, as Pulse for VS Code
  and Pulse for Orca read it. **Started** is when each began, "—" where the engine keeps no history.
- Each number has one home: a view's bar names only what its tiles do not (a process's key and,
  once, the version scope of its counts) and ends with when the numbers were read (**As of**).
  "First seen", "latest" and "last event" read as a time ago, the whole instant in their tooltip.
  The overview's top failures are rows that open their cause; an instance's history is one table
  on its route and in its tabs (state, start to the second, duration; an open step since when).
- The jobs view shows **All** jobs or those **Without retries** (a drill to the jobs without
  retries picks that scope), both counted; a job's row opens its instance, where its incident
  shows. In the **Incidents** tab an expanded process lists the activities of its root incidents by
  name; each row opens its failure cluster. Nothing reloads by itself: **Refresh** reads again.
- A chevron expands, an arrow opens. An incident's stacktrace scrolls with the keyboard and its
  button copies it whole, on the web app's page too, since copying changes nothing. A diagram fits
  the whole process; each zoom is a quarter, the first centres the marked element, and the arrow
  keys move the focused diagram.
- A deployment with board files (`ENGINE_BOARDS_DIR`) answers _"show me the leasing board"_ with
  the board's tiles, the ones Pulse for VS Code shows, and the cockpit's landing lists its boards
  ([Boards](boards.md)).
- If a tool isn't doing what you expect, ask the assistant to show you the raw
  arguments. It'll print them, and you can spot mismatches quickly.
