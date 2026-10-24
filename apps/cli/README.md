# Pulse CLI

[![npm version](https://img.shields.io/npm/v/@miragon/pulse-cli.svg)](https://www.npmjs.com/package/@miragon/pulse-cli)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse%2Fcli-blue.svg)](https://miragon.github.io/pulse/cli/)

A command line tool that lets an AI agent (or a human at a shell) **operate a Camunda 7 process
engine**: [Operaton](https://operaton.org), [CIB seven](https://cibseven.org) and Camunda 7. Deploy
processes and decisions, start and follow instances, work on tasks, fix incidents, migrate running
instances, look into the history and administer users and permissions. The agent says what should
happen, and the CLI talks to the REST API.

![pulse-cli finds the incident of an order with an expired card, fixes the variable and retries the job, and the order moves on to shipping](https://raw.githubusercontent.com/Miragon/pulse/main/docs/cli/assets/demo.gif)

## Why

A language model writes its answer token by token, so the time and the cost of a task grow with
the text it has to produce. Working with a process engine through its REST API is a lot of text.
Completing a single task takes one request to find the instance, one to see where it waits, one to
act and one to check the result, and each answer has to be read to build the next request. A
deployment, a migration or a search through the history is no different. An agent that works this
way is slow, and every id it copies is a chance to hit the wrong instance.

pulse-cli turns this around: the agent names what it means and what should happen, in one short
command, and the CLI sends the requests. What you get:

- One short command replaces a chain of requests, so the agent writes little and works fast.
- Answers contain what the next step needs, not everything the engine knows.
- The CLI lists its own commands and explains each one, so an agent looks things up instead of
  inventing them.
- Every change can be previewed, deleting needs an explicit yes, and an engine can be marked as
  look-only, so it is safe on real engines.
- Everything the REST API offers is a command: deployments, instances, tasks, incidents,
  migrations, history, decisions, users and permissions.
- It never asks questions, and both its answers and its errors are easy for a program to read, so
  scripts can use it too.

## Install

Requires Node.js 22.12+, or use Homebrew, the standalone executable or the container image (see
below).

```sh
npm install -g @miragon/pulse-cli      # or, without Node.js: brew install miragon/tap/pulse-cli
pulse-cli guide
```

## Quick start

Start an engine, then deploy a process, start an instance and complete its first task.
`order.bpmn` is any process with a user task; the [walk-through](https://miragon.github.io/pulse/cli/quick-start) has one.

```sh
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
pulse-cli ping
pulse-cli deploy order.bpmn --start --business-key ORD-1001 --var amount=250
pulse-cli advance --business-key ORD-1001 --var approved=true
```

```text
Advanced  review (userTask) via POST /task/74ef8d30-c652-11f1-ac07-4a8ec87eee1e/complete

Process instance  74ef661b-c652-11f1-ac07-4a8ec87eee1e
State             COMPLETED
Definition        order v1 (Order)
Business key      ORD-1001
Started           2026-10-12T15:34:47.666+0000
Ended             2026-10-12T15:34:47.916+0000

Variables:
NAME      VALUE  TYPE
amount    250
approved  true
```

On a terminal the answer is a table, as above; an agent or a script gets JSON.

## Commands

| Task                           | Commands                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| Deploy processes and decisions | `deploy`, `deployment`, `process-definition`, `decision-definition`      |
| Start and follow instances     | `inspect`, `wait`, `process-instance`, `message`, `signal`               |
| Work on tasks                  | `advance`, `task`, `external-task`                                       |
| Find and fix what failed       | `status`, `retry`, `incident`, `job`                                     |
| Change running instances       | `migration`, `modification`, `batch`                                     |
| Look into the history          | `historic-process-instance`, `historic-task-instance`, 13 more groups    |
| Administer the engine          | `user`, `group`, `tenant`, `authorization`, `metrics`, `history-cleanup` |
| Call any other REST operation  | `<group> <command>`, e.g. `filter list`; `api` for raw requests          |
| Ask the CLI itself             | `guide`, `commands`, `describe`, `--help`                                |
| Set up engines and logins      | `config`, `auth`, `completion`, `ping`                                   |

The six top-level commands (`inspect`, `wait`, `advance`, `retry`, `deploy`, `status`) combine
several requests; every other command is one operation of the REST API.

Details: [workflow commands](https://miragon.github.io/pulse/cli/workflow-commands),
[command structure](https://miragon.github.io/pulse/cli/commands), [recipes](https://miragon.github.io/pulse/cli/recipes).

## AI agents and the Claude Code plugin

Everything an agent needs is in the CLI: `pulse-cli guide` prints the usage guide, and one line in
`AGENTS.md` or `CLAUDE.md` ("Run `pulse-cli guide` before using `pulse-cli`") is enough. The CLI
is also a Claude Code plugin in Miragon's plugin marketplace, whose skill makes Claude use the CLI
whenever a task touches an engine.

```text
/plugin marketplace add Miragon/skills
/plugin install pulse-cli@miragon-agent-skills
```

Details: [using pulse-cli from AI agents](https://miragon.github.io/pulse/cli/agents).

## Engines

pulse-cli works with Operaton, CIB seven and Camunda 7, and is tested against all three on every
change. Camunda 8 is not supported: it has a different API.

Details: [engines](https://miragon.github.io/pulse/cli/engines).

## Without Node.js

Every release also has a standalone executable for Linux, macOS and Windows, and a container
image, `ghcr.io/miragon/pulse-cli`.

Details: [installation](https://miragon.github.io/pulse/cli/installation).

## Documentation

The documentation is a website, [miragon.github.io/pulse/cli](https://miragon.github.io/pulse/cli/),
built from the pages in [`docs/cli/`](https://github.com/Miragon/pulse/tree/main/docs/cli):

- [Getting started](https://miragon.github.io/pulse/cli/getting-started): a first triage, then your own engine, Claude Code or CI
- [Installation](https://miragon.github.io/pulse/cli/installation): npm, Homebrew, standalone executable, container image, shell completion
- [Quick start](https://miragon.github.io/pulse/cli/quick-start): one process from an empty engine to a finished instance
- [Workflow commands](https://miragon.github.io/pulse/cli/workflow-commands): inspect, wait, advance, retry, deploy, status
- [Command structure](https://miragon.github.io/pulse/cli/commands): names, arguments, variables, request bodies, files, dates
- [Output and errors](https://miragon.github.io/pulse/cli/output-and-errors): formats, previews, error fields, exit codes
- [Configuration](https://miragon.github.io/pulse/cli/configuration): options, environment variables, config and project files, profiles
- [Authentication](https://miragon.github.io/pulse/cli/authentication): Basic auth, OAuth logins, bearer tokens, token commands, other headers
- [Safety](https://miragon.github.io/pulse/cli/safety): previews, confirmation, read-only mode
- [Recipes](https://miragon.github.io/pulse/cli/recipes): command lines for everyday tasks
- [Using pulse-cli from AI agents](https://miragon.github.io/pulse/cli/agents): the guide, the Claude Code plugin and skill
- [Engines](https://miragon.github.io/pulse/cli/engines): compatibility, choosing the engine, adding a difference or an engine
- [Architecture](https://miragon.github.io/pulse/cli/architecture): engine port, adapters, catalog generation; [decisions](https://miragon.github.io/pulse/cli/adr/)
- [Development](https://github.com/Miragon/pulse/blob/main/docs/cli/development.md): building and testing the CLI in the Pulse repository

## Renamed from operate

Up to 0.10.0 this CLI was `@miragon/operate` with the command `operate`, released from
[Miragon/operate](https://github.com/Miragon/operate), which keeps its history and changelog.
Each old name has one new name:

- npm: `@miragon/operate` becomes `@miragon/pulse-cli` (command `pulse-cli`). The old package is
  deprecated; it stays installable and keeps its own `operate`.
- Homebrew: `miragon/tap/operate` becomes `miragon/tap/pulse-cli`; `brew upgrade` switches, and
  the formula keeps `operate` as an alias until the first release after 2027-01-31.
- Image: `ghcr.io/miragon/operate` becomes `ghcr.io/miragon/pulse-cli`.
- Variables: `OPERATE_URL`, `OPERATE_TOKEN` and the rest become `PULSE_CLI_URL`,
  `PULSE_CLI_TOKEN` and so on.
- Files: the project file `.operate.json` becomes `.pulse-cli.json`, the config directory
  `~/.config/operate` (Windows: `%APPDATA%\operate`) becomes `~/.config/pulse-cli`.

pulse-cli still reads the old variables and files, with one warning per run, until the first
release after 2027-01-31: [how](https://miragon.github.io/pulse/cli/installation#renamed-from-operate).

## Contributing

See the [development guide](https://github.com/Miragon/pulse/blob/main/docs/cli/development.md).
Bugs and ideas go to the [issues](https://github.com/Miragon/pulse/issues).

## License

[MIT](LICENSE) © Miragon GmbH
