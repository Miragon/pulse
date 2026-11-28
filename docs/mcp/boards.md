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
With boards it shows with one engine too: in full screen, and from a drilled view through the
first crumb of its trail, **All engines**. A board file that gives no board is listed by its id
with its count of problems; the server's log at startup says what they are.

With the [web app](../web/index.md) on, `/app` lists the same boards, and `/app/boards/<id>`
opens one in the browser with the same tiles and numbers, read with the token of whoever signed
in; an id the server has no board for, or a file that gives none, shows why, with a link to `/app`.
A page of its own reads a board's JSON form through `engine_get_board`, with its `formatVersion`.

## What a board shows

- A tile opens the view of its engine: an instance (an ended one in its history), an incident, a
  process or an engine's overview, the trail's first crumb back to the board. A count's filter
  stays on the board: it opens its process, or for instances with incident the process's incidents.
- **Refresh** reads what the server has not kept: it keeps each engine's reads of a board for 30
  seconds per user, so after a failure only that engine is read again, and the bar says when the
  oldest number was read (**As of**).
- An engine that cannot be read, or has not said what it is within 15 seconds, gets a strip of its
  own and "not read" in its cells; one that has keeps "not read" in the cells it missed, no strip.
  A total then says how many engines it counts, and a number that was not read never shows as 0.
- A broken widget lists its problems in its place; the other tiles read as usual.

## Set up the server's boards

Put the board files (`*.board.json`) in one directory and name it in `ENGINE_BOARDS_DIR`
([Operations](operations.md#environment-variables)). The server reads them at startup, so a
restart reloads them. A board's id is its file name without `.board.json`: a letter or digit
first, then letters, digits, `.`, `_` and `-`, 64 at most, as the editors' **New Board** names a
file. A file named otherwise is skipped with a warning. A directory or a file that cannot be read
stops the server; a file that gives no board, a file's note and an engine no profile names are
warnings at startup.

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

A board reads a Camunda 8 cluster from 8.9 on beside the other engines, with the tiles and numbers
the editors show; its `camunda8` profile names the cluster and the server's own client
([Camunda 8](camunda8.md)). A cluster's tiles show their counts, rows and diagram; in the chat they
open nothing, in the web app its screens, and a cluster that fails shows in its place.
