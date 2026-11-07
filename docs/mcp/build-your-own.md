# Build your own server

[Miragon/pulse-starter](https://github.com/Miragon/pulse-starter) composes Pulse's published
modules, the engine tools and analytics with their widgets, into an MCP server of your own, next
to modules for your own systems. Start your repository from it with "Use this template" on
GitHub, or with the GitHub CLI:

```sh
gh repo create my-mcp-server --template Miragon/pulse-starter --private --clone
```

Prerequisites: Node.js 22 from 22.23.4, 24 from 24.22.1, or 26.12.1 and later (the starter's `engines`) and pnpm 10.32.1 (`corepack enable`; Node.js 25 and later
ship no corepack, so `npm i -g pnpm@10.32.1`).

## First run

In a clone of your new repository (after the button on GitHub, `git clone` it first):

```sh
cd my-mcp-server
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` serves `http://localhost:8400/mcp` and starts the official
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) next to it. Open the URL it
prints and render the notes of the example module `modules/mcp-notes` in its Apps tab: the widget
needs no engine. Copying that module is how you start yours; name it in `MCP_ACTIVE_MODULES` too,
since the copied `.env` runs only `engine,notes` (the starter's engine comes without a Prometheus).

## Write a module

A module's plugin registers on the official MCP TypeScript SDK itself: `register(server)` gets the
SDK's `registerTool` and `registerPrompt`, so tools and prompts follow the
[SDK docs](https://ts.sdk.modelcontextprotocol.io/v2/) and views
[MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/). Pulse adds only what composes
modules into one server: the module contract (config from the environment, instructions, boot
warnings), the registrar for tools the model reads, toolsets that fail closed, and the view runtime
its widgets render in. The starter's [CLAUDE.md](https://github.com/Miragon/pulse-starter/blob/main/CLAUDE.md)
holds that contract, its [skills](https://github.com/Miragon/pulse-starter/tree/main/.claude/skills) walk through
a module and a widget, its [README](https://github.com/Miragon/pulse-starter#readme) covers engines, image and assistants.

## Updates

Your repository does not update itself: watch the starter's
[releases](https://github.com/Miragon/pulse-starter/releases) (Watch → Custom → Releases). Pulse is below 1.0,
so keep the starter's exact pins, update them together and read the
[changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) for every breaking change. The starter
mirrors `templates/composed-server/` in Miragon/pulse: report a problem [there](https://github.com/Miragon/pulse/issues).
