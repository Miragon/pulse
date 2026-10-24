# Using operate from AI agents

`operate` is built to be driven by coding agents. Everything an agent needs is in the CLI itself.
Point your agent at it, e.g. in `AGENTS.md` or `CLAUDE.md`: "Run `operate guide` before using
`operate`."

```sh
operate guide
operate commands --search 'process instance'
operate describe process-definition start
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
operate guide auth
```

- `operate guide` prints a short usage guide with an index of topics. `operate guide <topic>`
  prints one topic (`workflow`, `input`, `output`, `config`, `auth`, `recipes`),
  `operate guide --list` lists them. Every command line in the guide is tested against the CLI.
- `operate commands [group]` and `--search <words>` list commands; `operate describe` returns
  arguments, options, body schema and examples as JSON. `--dry-run` previews a write.
- `operate api <METHOD> <path>` sends a raw request with the same guards, output and errors.
- The workflow commands (`inspect`, `wait`, `advance`, `retry`, `deploy`, `status`) drive a process
  instance without passing ids around. `operate wait` replaces `sleep`; exit code 9 means the
  process did not reach the expected state.
- With OAuth, a person logs in once with `operate auth login`; agents never do. A command that
  needs a login fails with `LOGIN_REQUIRED` (exit 4) and names the command to run.
  `operate auth status` tells whether the login is usable.
- A bearer token from `OPERATE_TOKEN` is never refreshed: on `TOKEN_EXPIRED` (exit 4) the agent
  asks for a new one. A [token command](authentication.md#token-commands) in the `env` of
  `.claude/settings.json` fetches short-lived tokens instead.
- A [project file](configuration.md#project-file) (`.operate.json`) ships the repository's engines,
  so an agent session needs no setup. It names engines, never credentials.

## Claude Code plugin

This repository is a Claude Code plugin marketplace, `miragon`, with one plugin, `operate`:

```text
/plugin marketplace add Miragon/operate
/plugin install operate@miragon
```

From a shell: `claude plugin marketplace add Miragon/operate` and
`claude plugin install operate@miragon`. The plugin contains:

- The skill `operate`, the text of `operate guide`. Claude Code loads it when a task reads or
  changes the state of a Camunda 7, Operaton or CIB seven engine; `/operate` loads it by hand.
- The command `/operate:status [options]`: Claude runs `operate status` (read-only) and summarizes
  incidents, overdue jobs, external task workers and next commands. Only the bare `operate status`
  and `operate ping` run without a permission prompt.

The CLI is not part of the plugin: install it with `npm install -g @miragon/operate`, otherwise the
skill runs `npx -y @miragon/operate`. Plugin and npm versions match. Claude Code does not update
third-party plugins on its own: after a release, run the commands below, or turn on auto-update for
`miragon` under **Marketplaces** in `/plugin`.

```sh
claude plugin marketplace update miragon
claude plugin update operate@miragon
```

If you copied `SKILL.md` into a skills directory before, remove that copy
(`rm -r ~/.claude/skills/operate`); otherwise Claude Code lists the skill twice.

The plugin lives in [`apps/cli/skills/pulse-cli`](https://github.com/Miragon/pulse/tree/main/apps/cli/skills/pulse-cli).
The npm package ships it too, so
`claude --plugin-dir "$(npm root -g)/@miragon/operate/skills/pulse-cli"` loads the installed version
for one session.

## Claude Code skill without the plugin

[`apps/cli/skills/pulse-cli/SKILL.md`](https://github.com/Miragon/pulse/blob/main/apps/cli/skills/pulse-cli/SKILL.md)
is the core guide as a Claude Code skill; it ships with the npm package. To use it without the
plugin (not in addition to it), install it for all your projects or for one project:

```sh
mkdir -p ~/.claude/skills/operate
cp "$(npm root -g)/@miragon/operate/skills/pulse-cli/SKILL.md" ~/.claude/skills/operate/

mkdir -p .claude/skills/operate
curl -fsSL https://raw.githubusercontent.com/Miragon/pulse/main/apps/cli/skills/pulse-cli/SKILL.md -o .claude/skills/operate/SKILL.md
```
