# Getting started

You need Node.js 22.12 or later and a reachable Camunda 7 REST API: Operaton, CIB seven or
Camunda 7. operate uses `http://localhost:8080/engine-rest` by default, so a local Operaton
container needs no configuration. Give it a few seconds to start before the first command.

## A first triage

```sh
npm install -g @miragon/operate
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
operate ping
operate status
```

`operate ping` checks the connection. `operate status` triages the whole engine in one read-only
call: incidents grouped by root cause, overdue jobs, external task workers and failed batches,
each finding with the next command to run. The Operaton image ships the invoice example, so a
fresh container already has instances, and no findings:

```text
Engine  http://localhost:8080/engine-rest (version 2.1.5, 13ms)
Status  ok

Definitions:
KEY            VERSIONS  INSTANCES  INCIDENTS  FAILED JOBS
invoice        2         6          0          0
ReviewInvoice  1         2          0          0

Jobs       0 executable
Tasks      6 open
Batches    0 running, 0 with failures
Incidents  0 open, 0 propagated
```

The [quick start](./quick-start.md) goes on from here: it deploys a process of its own, starts an
instance and completes its first task. Without Node.js, take the standalone executable or the
container image from [installation](./installation.md).

## Your engine, Claude Code or CI

Point operate at your own engine with a read-only profile, or hand it to Claude Code or your CI
pipeline. A profile also holds the engine's Basic auth, OAuth or bearer token settings, see
[authentication](./authentication.md).

::: code-group

```sh [Your engine]
operate config set prod --url https://engine.example.com/engine-rest --read-only
operate status --profile prod
```

```text [Claude Code]
/plugin marketplace add Miragon/operate
/plugin install operate@miragon
/operate:status
```

```sh [CI]
export OPERATE_URL=https://engine.example.com/engine-rest
operate status --read-only --fail-on warning
```

:::

The [Claude Code plugin](./agents.md#claude-code-plugin) calls the CLI you installed, or
`npx -y @miragon/operate` if there is none. Other agents need one line in `AGENTS.md` or
`CLAUDE.md`: "Run `operate guide` before using `operate`."

In CI, `--fail-on warning` fails on any finding, an open incident included. `--fail-on critical`
fails only when executable jobs are overdue, and that finding asks whether the job executor is
running. Either way the command exits with code 9 (`CHECK_FAILED`).

## Where next

- [Workflow commands](./workflow-commands.md): `inspect`, `wait`, `advance`, `retry`, `deploy` and
  `status`, the six commands that combine several requests.
- [Recipes](./recipes.md): command lines for everyday tasks.
- [Safety](./safety.md): previews, confirmation and read-only mode.
