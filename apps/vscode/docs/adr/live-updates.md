# Live updates

- Status: accepted
- Last reviewed: 2026-10-23

## Context

Until v0.2 every view showed what it read when it opened and changed only on Refresh or
after a write. The maintainer asked for views that are always current. Six independent
reviews (a market benchmark of Camunda 8 Operate, Camunda 7 Cockpit, Temporal, Airflow,
Grafana, Argo, Prefect, Dagster and VS Code extensions that poll; Jonas, process developer;
Aylin, ops on call; Sophie, architect for C7 and C8; Clara, UX; Eva, platform and security)
researched in isolation, agreed in two ballot rounds, and validated the built result.

What they found:

- No engine of the C7 family pushes to a REST client, and C8 clients read eventually
  consistent storage. Every benchmarked cockpit polls lists, counts and diagram
  statistics; push exists only for append-only logs. Polling the existing ports is the
  only engine-neutral way.
- A read is expensive here: every port call starts at least one CLI process (about 120 ms
  and 100 MB on a laptop) that makes one or more REST calls with a password check each. A
  definition panel at 5 s would start over 100 processes a minute; many laptops polling
  one shared engine add up. Ten failed logins lock a C7 user until an admin unlocks it.
- Hidden tabs, an unfocused window or an idle desk must cost nothing. Users must never lose
  what they look at: version, filter, loaded pages, zoom, editor text, focus.

## Decision

### What updates, how often

| View                                      | Local | Test | Production, unclassified (once turned on) |
| ----------------------------------------- | ----- | ---- | ----------------------------------------- |
| Instance panel (until the instance ended) | 5 s   | 15 s | 30 s                                      |
| Definition panel                          | 10 s  | 30 s | 60 s                                      |
| Engine overview                           | 15 s  | 30 s | 60 s                                      |
| Engines tree, expanded engines only       | 30 s  | 60 s | 120 s                                     |

- A view reads only while it is **visible** (in any editor group) **and** the window is
  **focused** **and** the window was **active within the last 15 minutes** (VS Code's
  `WindowState.active`, plus clicks, keys and wheel input inside a Pulse webview, reported
  at most every 30 s). When it becomes visible again it reads at once if its data is older
  than its interval, spread over up to 2 s.
- The next read is scheduled after the last one finished: the interval ±20 %, and never
  sooner than four times the last load's duration, also when catching up and after
  failures, so a slow engine is read less often.
- One automatic read per engine at a time (`EngineLane`, shared by every profile with the
  same endpoint and login). A tick that finds the lane busy tries again within 2 s; the
  retry check after a write waits for the lane.
- `pulse.liveUpdates` turns environments `on` or `off`. Without a value local and test are on,
  production and unclassified off. Only the user settings count (`scope: application`, like
  `pulse.writes`): a workspace or a dev container cannot turn live updates on, and cannot
  turn them off either. The Off
  stamp offers "Turn on live updates for production engines", which writes the user
  setting. Changing only this setting switches the open views in place; other `pulse.*`
  changes rebuild the connections, keep each engine's lane while endpoint and login stay,
  and load a hidden panel only when it is shown again.
- Failures keep the data. Unreachable or failing engines back off (`interval · 2ⁿ`, half
  jitter, capped at 30 s local, 5 min test, 15 min production) and return to live on the
  first success. Unauthorized, forbidden or misconfigured from any load (panels, tree,
  status bar) blocks the lane of that engine: no view reads it on its own and retry checks
  stop until a load of that engine succeeds or the login changes.
- On a tick the definition panel reads element statistics, the first page of instances
  (unless Load more added pages) and the Running and With incident counts (history counts
  in the C7 adapter). The version list is read on every tick locally and every fourth tick
  elsewhere; the Ended count every fourth tick on local and test engines and only on user
  loads on production, where Ended and All say "Ended and All update when you refresh."
  Called-process wiring, `describeEngine`, the diagram and the local `.bpmn` files are not
  read on a tick. The instance panel reads its detail; incident links and the complete
  stack trace of the first incident are read again only when the incidents change.
- The tree, the status bar and the engine overview share one `listDefinitions` per engine
  (`SharedDefinitions`): a read in flight is joined, the age counts from the answer, a
  failure is kept as long as a result, and a write or a nudge marks the result,
  even one still in flight, as outdated. Ticks and user loads ask for a fresh result, the
  tree's expansion reuses one up to 5 s old, the status bar one up to 60 s old and reads
  nothing while the engine is blocked.
- On a local engine, saving a `.bpmn` file and the end of a debug session or task nudge
  visible views to read within 2 s, at most once every 5 s (a later trigger runs when the 5 s
  are over).

### Bulk progress is not a tick

A running bulk operation ([writes.md](writes.md)) is followed by a poll of its own
(`BulkFollow` in `apps/vscode/src/core/panels`), not by the panel's ticks:

- Cadence 2, 3 and 5 s after the submit (and after a panel picks the run up), then
  every 10 s, on every engine; the setting `pulse.liveUpdates` and the pause button do not
  change it.
- One panel follows a run, and only while it is watched: it lets the run go when it is
  hidden or closed, and any watched panel of the process picks it up again, on load and
  whenever it becomes watched, also after a rebind or a connection reload. The stall time
  counts only while a panel watches and starts afresh when one comes back.
- Every read goes through the engine's `EngineLane`. While the lane is blocked it reads
  nothing and the strip names the problem "Paused until the engine accepts the login
  again."; it goes on after the lane is unblocked. An unauthorized, forbidden or misconfigured
  answer, to a poll or to Stop, blocks the lane like any other load. A failed read
  shows "Pulse can't read its progress: …" until the next read succeeds; it never
  counts as a stall.
- It costs one call per poll (`getBulkOperation`) and, at the end, one `countInstances`
  (two for a migration: still on the source, now on the target) plus one
  `getBulkFailures` when items failed, then one reload of the panel through the lane. None of it counts towards a tick's
  budget.
- While a bulk write re-reads, asks and submits, the panel skips its ticks, as for a
  single write.

### What the user sees

- Background reads are silent: no spinner, no "Refreshing…", no busy state, no disabled
  button. The stamp's time moves. User-started loads keep their progress as before.
- Stamp states: `As of 14:03:12` (tooltip: the cadence), `Paused · as of …` (tooltip:
  paused by you, in the background, idle, or while a variable is edited),
  `As of … · 2m ago` with a clock when nothing succeeded for two intervals and 10 s,
  `Reconnecting… · data from …` (tooltip: when Pulse tries again), `Stopped · data from …`
  when the engine refused the login or the subject is gone, `Offline · data from …` after a
  failed user load, the ended tooltip for an ended instance, and the Off tooltip naming the
  setting and the cadence it would have.
- A pause button left of the stamp pauses this panel; it never resumes on its own, and
  resume reads at once.
- Nothing moves on its own: a definition panel stays on the version it shows and adds an
  info strip "v3 was deployed. · Show v3"; after Load more the rows stay and only counts,
  badges and diagram update; the engine overview keeps its row order until a user load;
  table focus follows the row and moves to its neighbour when the row leaves; overlays are
  redrawn only when they changed; an open variable editor or move panel holds its panel until
  it closes or the panel is hidden; a write confirmation holds it too and names the data's age ("Data read
  2 min 5 s ago · live updates are paused").
- No notifications or toasts from anything a background read finds.

### Where it lives

- `apps/vscode/src/core/refresh`: `RefreshCadence` (intervals, self-throttle, backoff, jitter,
  history and version ticks), `RefreshLoop` (attention, pause, editor hold, nudge,
  single-flight, status), `EngineLane` (one automatic read per engine, blocked on auth
  failures), `LiveSwitch` (the engine's setting, switched in place), `SharedDefinitions`,
  `DefinitionsLoop` (the tree's loop per engine), `PanelLive` (a panel's loop and its
  intents), `LiveFailures`. A `Scheduler` port keeps it testable without timers
  (`ManualScheduler` in the tests).
- `ViewSession.refreshQuietly` publishes without `refreshing`; it skips while a load or
  Load more runs and drops a tick a newer load overtook. A transient failure returns
  `failed` without publishing; a stopping failure publishes the failure with the stale view.
  A closed session publishes nothing, so a read still running when its panel closes or
  rebinds cannot paint over the new session, and a closed instance panel stops checking its
  retry. A session with nothing loaded (its first load failed, or it was rebound while its
  engine was blocked) runs its full load on the next tick.
- `apps/vscode/src/host/live`: `WindowAttention` (focus, activity, 15 min idle),
  `TimerScheduler`, `LiveWiring` (a `LiveContext` per connection with its log),
  `LiveTriggers` (dev-loop nudges). `EngineLanes` keeps lanes across connection reloads.
  `OpenPanel` creates and disposes the session with its loop, also on rebind.
  `EnginesTreeLive` runs one `DefinitionsLoop` per engine of the tree.
- The contract does not change: no `observedAt`, no change probe. `asOf` is the start of the
  load.
- Tests pin the engine calls of one tick (port calls, not CLI processes): instance at most
  2, definition at most 7, no local file reads on a tick.

## Consequences

- Loop start, pause, resume, stop and failures (with the next try) go to the Pulse output
  channel, prefixed with the engine name; never credentials, bodies or values.
- Deferred, in this order: one probe call before the parallel reads of a manual load (so a
  stale password costs one failed login, not nine); a per-call timeout for background reads
  in the adapter with "Paused · engine not answering" after three timeouts; a count instead
  of `incident list --all` behind the version list and the shared engine summary before
  production goes on by default; a re-read before a single write (bulk writes have one); a
  "3 new · Update list" pill; editor rows that stay when the engine removes their variable;
  a highlight and polite announcements for changed values (need freshness semantics for
  C8); `User-Agent` and `X-Pulse-Trigger` headers; visible-but-unfocused at four times the
  interval as an opt-in; comparing a model panel's drift again after its `.bpmn` was saved.
- A C8 adapter needs no change here; reads that go backwards for a few seconds only move the
  stamp, because nothing is derived from the difference between two ticks.
