# Build your own server

[Miragon/pulse-starter](https://github.com/Miragon/pulse-starter) composes Pulse's published
modules, the engine tools and analytics with their widgets, into an MCP server of your own, next
to modules for your own systems. Start your repository from it with "Use this template" on
GitHub, or with the GitHub CLI:

```sh
gh repo create my-mcp-server --template Miragon/pulse-starter --private --clone
```

## Prerequisites

- Node.js 22.22.2 or later
- pnpm 10.32.1: `corepack enable`; Node.js 25 and later ship no corepack, so `npm i -g pnpm@10.32.1`

## First run

In a clone of your new repository (after the button on GitHub, `git clone` it first):

```sh
cd my-mcp-server
pnpm install
cp .env.example .env
pnpm dev
```

Open the inspector at `http://localhost:8400/mcp/inspector` and call the tool that shows the
notes of the example module `modules/mcp-notes`: its widget renders without an engine. Copying
that module is how you start yours.

Pulse is below 1.0, so any release can change the `@miragon/pulse-*` packages: keep the starter's
exact pins, update all of them together, and read the
[changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) for every breaking change.

## Next steps

- The [starter README](https://github.com/Miragon/pulse-starter#readme) covers the engine
  settings, the container image and connecting an assistant.
- Its agent files guide Claude Code or any agent that reads them:
  [CLAUDE.md](https://github.com/Miragon/pulse-starter/blob/main/CLAUDE.md) holds the module
  contract and its rules, and the
  [skills](https://github.com/Miragon/pulse-starter/tree/main/.claude/skills) walk through setting
  up the server, creating a module and adding a widget.
- The starter is a read-only mirror of `templates/composed-server/` in Miragon/pulse: report a
  problem or propose a change [there](https://github.com/Miragon/pulse/issues).
