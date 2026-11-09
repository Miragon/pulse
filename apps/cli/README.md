# Pulse CLI

[![npm](https://img.shields.io/npm/v/@miragon/pulse-cli)](https://www.npmjs.com/package/@miragon/pulse-cli)
[![Homebrew](https://img.shields.io/badge/Homebrew-miragon%2Ftap%2Fpulse--cli-FBB040?logo=homebrew&logoColor=white)](https://github.com/Miragon/homebrew-tap)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

![Pulse CLI by Miragon AI: every engine operation as one short command, for you and your agent. The card shows pulse status finding four incidents at Charge payment and pulse retry resolving one](https://raw.githubusercontent.com/Miragon/pulse/main/docs/assets/listing/cli/cover.png)

A command line tool with which you and your AI agent run a Camunda 7, CIB seven or Operaton engine
(not Camunda 8), one short command per step. Below 1.0: pin the version, since a release can
rename a command.

## Why

An agent that works through the REST API needs a chain of requests for every step and copies ids
from one answer into the next, which is slow and a chance to hit the wrong instance. With the Pulse
CLI the agent names what should happen, and the CLI sends the requests.

## What you get

- **One command instead of a chain.** `inspect`, `status`, `retry` and `advance` each combine
  several requests.
- **Answers for the next step.** A table on a terminal, JSON for an agent or a script, each with
  what the next step needs.
- **Safe on real engines.** Every change can be previewed with `--dry-run`, deleting needs an
  explicit yes, and an engine can be marked read-only.
- **The engine's REST API.** Every other REST operation is a command too.

![pulse-cli status finds five incidents at Charge payment, and pulse-cli inspect shows that order ORD-10130 waits there because the card expired, with the expiry date among its variables](https://raw.githubusercontent.com/Miragon/pulse/main/docs/assets/cli-triage.gif)

## Install

Each channel installs the command `pulse` (`pulse-cli` is a second name of the same program).

- **npm** (Node.js 22.12 or later): `npm install -g @miragon/pulse-cli`
- **Homebrew** (macOS, Linux): `brew install miragon/tap/pulse-cli`
- **Standalone executable** (Linux, macOS, Windows, no Node.js) or **container image**
  `ghcr.io/miragon/pulse-cli`: see [Installation](https://miragon.github.io/pulse/cli/installation),
  which also covers proxies and certificates.

Which engine versions are tested: [Engines](https://miragon.github.io/pulse/cli/engines).

## Get started

Start a local engine, then deploy a process, start an instance and complete its first task.
`order.bpmn` is any process with a user task; the [walk-through](https://miragon.github.io/pulse/cli/getting-started#your-first-process) has one.

```sh
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
pulse ping
pulse deploy order.bpmn --start --business-key ORD-1001 --var amount=250
pulse advance --business-key ORD-1001 --var approved=true
```

`pulse` talks to `http://localhost:8080/engine-rest` until you set up a profile. Your own engine,
logins and read-only profiles: [Configuration](https://miragon.github.io/pulse/cli/configuration),
[Authentication](https://miragon.github.io/pulse/cli/authentication) and [Safety](https://miragon.github.io/pulse/cli/safety).

## Commands

Which commands cover a task. The six top-level ones (`inspect`, `wait`, `advance`, `retry`,
`deploy`, `status`) combine several requests; every other is one REST operation.

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
| Set up engines and logins      | `config`, `auth`, `ping`                                                 |

Everyday command lines: [Recipes](https://miragon.github.io/pulse/cli/recipes).

## With your AI assistant

`pulse guide` prints the usage guide for an agent, so one line in `AGENTS.md` or `CLAUDE.md`
("Run `pulse guide` before using `pulse`") is enough. In Claude Code, the plugin makes Claude use
the CLI whenever a task touches an engine:

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-cli@pulse
```

Details: [Using the CLI from AI agents](https://miragon.github.io/pulse/cli/agents).

## Help and feedback

- **Documentation:** every command, option and setup is explained at [miragon.github.io/pulse/cli](https://miragon.github.io/pulse/cli/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build and test the CLI is in the [development guide](https://github.com/Miragon/pulse/blob/main/docs/cli/development.md).

## License

[MIT](LICENSE) © Miragon GmbH
