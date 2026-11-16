# Boards

A board keeps the questions your team asks again and again in one view: how many applications
wait for a decision, which processes have incidents, which instances run at a step. It is a JSON
file, the same format Pulse for VS Code and Pulse for Orca read ([Boards](../vscode/boards.md)
describes the widgets and filters), so a team keeps its boards in a repository and shares them. A
board only reads; it never writes to an engine.

## Open a board

Ask for it in the chat: _"show me the leasing board"_. The assistant finds its id with
`engine_list_engines`, which names the server's boards with their titles and engines, and opens it
with `engine_open_cockpit`, `view` `board` and the board's id, without `engine`: a board reads
the engines it names. It shows inline in the chat or full screen, in your chat app's language,
with the tiles the editors show and the same numbers.

In the cockpit, the landing lists the boards under the engines, each with the engines it reads.
With boards it shows with one engine too, and a view's trail leads there through its first crumb,
**All engines**. A board file that gives no board is listed by its id with its count of problems;
the server's log at startup says what they are.

## What a board shows

- A tile opens the view of its engine: an instance (an ended one in its history), an incident, a
  process or an engine's overview, and the trail's first crumb leads back to the board. A count's
  filter stays on the board: it opens its process, or the process's incidents for instances with
  incident.
- **Refresh** reads every engine again. The server keeps a board's read for 30 seconds per user,
  and the bar says when it was read (**As of**).
- An engine that cannot be read gets a strip of its own and "not read" in its cells; a total then
  says how many engines it counts. A number that was not read never shows as 0.
- A broken widget lists its problems in its place; the other tiles read as usual.

## Set up the server's boards

Put the board files (`*.board.json`) in one directory and name it in `ENGINE_BOARDS_DIR`
([Operations](operations.md#environment-variables)). The server reads them at startup, so a
restart reloads them. A board's id is its file name without `.board.json`: a letter or digit
first, then letters, digits, `.`, `_` and `-`, 64 at most. A file named otherwise is skipped with
a warning. A directory or a file that cannot be read stops the server; a file that gives no board,
a file's note and an engine no profile names are warnings at startup.

```sh
ENGINE_BOARDS_DIR=/etc/pulse/boards   # in Docker, mount the directory read-only
```

`pnpm play` sets it to `playground/boards`, whose _Leasing operations_ board reads the playground's
engine `prod-a`.

## A board shared with the editors

A board's `engines` are profile names. Pulse for VS Code and Pulse for Orca take them from
`.pulse.json` or the CLI's user config, the server from the profiles of its own configuration
(`ENGINES_FILE` or `ENGINES_JSON`, else `ENGINE_ID` for its one engine). One file works on both
sides when both name the same engines. A name the server has no profile for shows as "is not among
the engines of this server", and its tiles stay empty.

## Camunda 8

The server serves Camunda 7, CIB seven and Operaton. It refuses a `camunda8` profile at startup,
so a board that names one shows that engine as not read, its profile refused, beside the numbers
of the other engines. Pulse for VS Code and Pulse for Orca read boards over Camunda 8 clusters
([Camunda 8](../vscode/camunda8.md)).
