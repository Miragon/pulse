# Using pulse-cli from AI agents

`pulse-cli` is built to be driven by coding agents. Everything an agent needs is in the CLI itself.
Point your agent at it, e.g. in `AGENTS.md` or `CLAUDE.md`: "Run `pulse-cli guide` before using
`pulse-cli`."

```sh
pulse-cli guide
pulse-cli commands --search 'process instance'
pulse-cli describe process-definition start
pulse-cli process-definition start invoice --var amount=250 --dry-run
pulse-cli process-definition start invoice --var amount=250
pulse-cli guide auth
```

- `pulse-cli guide` prints a short usage guide with an index of topics. `pulse-cli guide <topic>`
  prints one topic (`workflow`, `input`, `output`, `config`, `auth`, `recipes`), the page of these
  docs that covers it, offline; `pulse-cli guide --list` lists them. Every command line in the guide is tested against the CLI.
- `pulse-cli commands [group]` and `--search <words>` list commands; `pulse-cli describe` returns
  arguments, options, body schema and examples as JSON. `--dry-run` previews a write.
- `pulse-cli api <METHOD> <path>` sends a raw request with the same guards, output and errors.
- The workflow commands (`inspect`, `wait`, `advance`, `retry`, `deploy`, `status`) drive a process
  instance without passing ids around. `pulse-cli wait` replaces `sleep`; exit code 9 means the
  process did not reach the expected state.
- With OAuth, a person logs in once with `pulse-cli auth login`; agents never do. A command that
  needs a login fails with `LOGIN_REQUIRED` (exit 4) and names the command to run.
  `pulse-cli auth status` tells whether the login is usable.
- A bearer token from `PULSE_CLI_TOKEN` is never refreshed: on `TOKEN_EXPIRED` (exit 4) the agent
  asks for a new one. A [token command](authentication.md#token-commands) in the `env` of
  `.claude/settings.json` fetches short-lived tokens instead.
- A [project file](configuration.md#project-file) (`.pulse-cli.json`) ships the repository's
  engines, so an agent session needs no setup. It names engines, never credentials.

## Claude Code plugin

The CLI is also a Claude Code plugin, `pulse-cli`, in the plugin marketplace `pulse` of this
repository (`.claude-plugin/marketplace.json`):

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-cli@pulse
```

From a shell: `claude plugin marketplace add Miragon/pulse` and
`claude plugin install pulse-cli@pulse`. The plugin contains:

- The skill `pulse-cli`, the text of `pulse-cli guide`. Claude Code loads it when a task reads or
  changes the state of a Camunda 7, Operaton or CIB seven engine; `/pulse-cli` loads it by hand.
- The command `/pulse-cli:status [options]`: Claude runs `pulse-cli status` (read-only) and
  summarizes incidents, overdue jobs, external task workers and next commands. Only the bare
  `pulse-cli status` and `pulse-cli ping` run without a permission prompt.

The CLI is not part of the plugin: install it with `npm install -g @miragon/pulse-cli`, otherwise
the skill runs `npx -y @miragon/pulse-cli`. Plugin and npm versions match. Claude Code does not
update third-party plugins on its own: after a release, run the commands below, or turn on
auto-update for `pulse` under **Marketplaces** in `/plugin`.

```sh
claude plugin marketplace update pulse
claude plugin update pulse-cli@pulse
```

If you copied `SKILL.md` into a skills directory before, remove that copy
(`rm -r ~/.claude/skills/pulse-cli`); otherwise Claude Code lists the skill twice.

The plugin lives in
[`apps/cli/skills/pulse-cli`](https://github.com/Miragon/pulse/tree/main/apps/cli/skills/pulse-cli).
The npm package ships it too, so
`claude --plugin-dir "$(npm root -g)/@miragon/pulse-cli/skills/pulse-cli"` loads the installed
version for one session.

## Claude Code skill without the plugin

[`apps/cli/skills/pulse-cli/SKILL.md`](https://github.com/Miragon/pulse/blob/main/apps/cli/skills/pulse-cli/SKILL.md)
is the core guide as a Claude Code skill; it ships with the npm package. To use it without the
plugin (not in addition to it), install it for all your projects or for one project:

```sh
mkdir -p ~/.claude/skills/pulse-cli
cp "$(npm root -g)/@miragon/pulse-cli/skills/pulse-cli/SKILL.md" ~/.claude/skills/pulse-cli/

mkdir -p .claude/skills/pulse-cli
curl -fsSL https://raw.githubusercontent.com/Miragon/pulse/main/apps/cli/skills/pulse-cli/SKILL.md -o .claude/skills/pulse-cli/SKILL.md
```
