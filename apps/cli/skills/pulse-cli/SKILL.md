---
name: pulse-cli
description: Inspect and operate Camunda 7, Operaton and CIB seven process engines through their REST API with pulse-cli (deployments, process instances, user tasks, external tasks, incidents, jobs, history, variables, decisions), and drive process instances with its workflow commands (inspect, wait, advance, retry, deploy, status). Use it whenever a task needs to read or change the state of such an engine.
---

# pulse-cli: the Camunda 7 REST API from the command line

`pulse-cli` calls the REST API (`/engine-rest`) of Camunda 7 process engines: Operaton, CIB seven
and Camunda 7 CE/EE. Every REST operation is a command generated from the OpenAPI spec:
`pulse-cli <group> <command> [path-args...] [options]`; workflow commands such as
`pulse-cli inspect` combine several requests. It never prompts, prints JSON when stdout is not a
terminal, reports errors as one JSON line on stderr (the last line) and uses stable exit codes.
This core guide covers everyday use; `pulse-cli guide <topic>` prints the details of a topic (see
Topics at the end).

## Setup

If `pulse-cli` is missing, run `npx -y @miragon/pulse-cli` in its place or ask the user to install
it with `npm i -g @miragon/pulse-cli` (Node.js 22.12+). The REST API root defaults to
`http://localhost:8080/engine-rest`. Set it per shell, then check the connection:

```sh
export PULSE_CLI_URL=http://localhost:8080/engine-rest
pulse-cli ping
```

A repository may ship its engines as profiles in a project file (`.pulse-cli.json`): check
`pulse-cli config list` first (scope `project`), a bare `pulse-cli ping` then uses its default.

Or keep each engine in a profile and pick one with `--profile`. `--url` and `PULSE_CLI_URL` override
the URL of every profile (and its credentials go along), so unset `PULSE_CLI_URL` first:

```sh
unset PULSE_CLI_URL
pulse-cli config set local --url http://localhost:8080/engine-rest --default
pulse-cli config set prod --url https://camunda.example.com/engine-rest --read-only
pulse-cli ping --profile prod
```

- `pulse-cli ping` prints `{url, engine, reachable, version, engines, latencyMs, auth}` (`user`
  too).
- Precedence for every setting: flag > environment variable > profile > default.
- Links to Cockpit: take `values.cockpitUrl` from `pulse-cli config show -o json`; when it is null,
  ask the user for the Cockpit URL instead of guessing it from the engine URL.
- Profiles, project files, environment variables, named engines and headers:
  `pulse-cli guide config`. Basic auth, bearer tokens and token commands (also for single sign-on):
  `pulse-cli guide auth`.

## Discover, describe, preview, run

Never guess commands or flags. Look them up, preview writes, then run:

```sh
pulse-cli commands
pulse-cli commands --search incident
pulse-cli describe process-definition start
pulse-cli process-definition start invoice --var amount=250 --dry-run
pulse-cli process-definition start invoice --var amount=250
```

- `pulse-cli commands` lists the groups (and `workflow`); `pulse-cli commands <group>` the commands
  of a group with method, path, effect and summary; `--search` finds commands whose command, alias,
  operationId, summary or path contain every word (`--search 'process instance'`); `--effect`
  filters by `read`, `write`, `delete` or `bulk`.
- `pulse-cli describe <group> <command>` (or an operationId or workflow command) shows arguments,
  options, the request body schema, responses and examples (JSON when piped, text with `-o table`).
- `pulse-cli <group> <command> --help` shows the options; `pulse-cli guide` prints this guide.

## Workflow commands

Top-level commands that combine requests, so no id passes through you. They select an instance by
id, `--business-key` or `--process-definition-key <key> --latest`; `next` lists follow-ups:

- `pulse-cli inspect`: where an instance waits and why: wait states, root incidents, variables.
- `pulse-cli wait`: until the instance is idle, or
  `--until ended|incident|task[:key]|activity:<id>`.
- `pulse-cli advance`: completes what it waits for: user or external task, message, timer, job.
- `pulse-cli retry`: sets the retries behind open incidents; `--now` executes the jobs.
- `pulse-cli deploy`: deploys changed files and directories, reports the versions in effect.
- `pulse-cli status`: grouped incidents with root cause, overdue jobs, external task workers.

```sh
pulse-cli deploy bpmn --start --business-key B-1 --var amount=250
pulse-cli inspect --business-key B-1
pulse-cli advance --business-key B-1 --var approved=true --wait
pulse-cli retry --business-key B-1 --now
pulse-cli wait --business-key B-1 --until ended
pulse-cli status
```

Use `pulse-cli wait` or `--wait` (advance, retry, deploy) instead of `sleep`; it fails on incidents
with exit code 9, which still prints the view. Options and rules: `pulse-cli guide workflow`.

## Invocation conventions

- Path parameters are positional arguments in path order; query parameters and body properties are
  kebab-case flags (`businessKey` → `--business-key`); global options work after the command.
- Variables: `--var name=value`, repeatable and auto typed; force a type with `name:Type=value`,
  e.g. `--var zip:String=01234`.
- `--body <json>`, `--body @file.json` or `--body -` (stdin) is the base JSON body for nested
  structures; flags are merged on top, and the body is validated against the API schema.
- List commands with `--max-results` also take `--all` to fetch every page.
- Booleans, arrays, dates, variable types, files and the global options: `pulse-cli guide input`.

## Output

- stdout carries exactly the engine response (workflow commands: their view): JSON, compact when
  piped, indented on a terminal or with `--pretty`, always ending with a newline.
- `--fields id,name,variables.amount` keeps only these properties; `-o table` prints a table.
- No content (HTTP 204): stdout stays empty, stderr gets `Done: <METHOD> <path> → 204 No Content`.
- XML, text and binary responses, `--out-file`, `--dry-run` and `--verbose`:
  `pulse-cli guide output`.

## Errors and exit codes

Errors are one JSON line on stderr, its last line (`-o table` prints readable text instead):

```text
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: ...","status":404,"engineType":"InvalidRequestException","hint":"...","request":{"method":"GET","url":"..."}}}
```

| exit | meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | success                                                                                                |
| 1    | internal error                                                                                         |
| 2    | usage error, invalid body (`VALIDATION`), `READ_ONLY`, `CONFIRMATION_REQUIRED`                         |
| 3    | configuration error, also an HTTP redirect (`HTTP_REDIRECT`, see below)                                |
| 4    | auth failed: 401, 403, `LOGIN_FAILED` (the token command failed), `TOKEN_EXPIRED`                      |
| 5    | not found (404)                                                                                        |
| 6    | other 4xx: the engine rejected the request, read `engineMessage`                                       |
| 7    | engine error (5xx)                                                                                     |
| 8    | network error or timeout                                                                               |
| 9    | expected state not reached: `WAIT_TIMEOUT`, `INCIDENT`, `INSTANCE_ENDED`, `JOB_FAILED`, `CHECK_FAILED` |

Read `hint` first: it names the fix (`pulse-cli describe ...`, `--yes`, `--no-validate`, the
accepted date forms, ...); for unknown names it starts with "Did you mean ...?". Redirects are never
followed: a 3xx answer is `HTTP_REDIRECT` (exit 3), fix `--url` (`https`, a login page). Camunda 7
engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already claimed:
read `engineMessage` and fix the cause instead of retrying. On exit 4: `pulse-cli guide auth`.

## Safety

- `--dry-run` prints the request (`method`, `url`, `headers`, `body`, `curl`) without sending it.
  Use it before writes you are unsure about; it works in read-only mode too.
- Commands with effect `delete` or `bulk` (batches, query based updates, all versions of a key,
  `pulse-cli retry --process-definition-key` alone) refuse to run without `--yes` (exit 2,
  `CONFIRMATION_REQUIRED`). Add `--yes` only when the user asked for exactly that change.
- `--read-only`, `PULSE_CLI_READ_ONLY=1` or a profile created with `--read-only` refuse every
  command whose effect is not `read` (exit 2, `READ_ONLY`). Use read-only profiles for production.

## Topics

`pulse-cli guide <topic>` prints the details of a topic; `pulse-cli guide --list` lists the topics:

- `workflow`: Workflow commands in detail: selection, inspect, wait, advance, retry, deploy, status
- `input`: Arguments, flags, booleans, arrays, dates, variables, request bodies, files, paging
- `output`: JSON and tables, --fields, XML, text and binary responses, --out-file, previews
- `config`: Profiles, config and project files, environment variables, engines, headers, timeouts
- `auth`: Basic auth, bearer tokens and token commands, single sign-on, what to do on exit 4
- `recipes`: Command lines for everyday tasks: deploy, tasks, incidents, messages, history, api

```sh
pulse-cli guide --list
pulse-cli guide recipes
```

An older pulse-cli without topics answers "Too many arguments for 'guide'": run
`npx -y @miragon/pulse-cli@latest guide <topic>` instead, or ask the user to update pulse-cli.
