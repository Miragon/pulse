# Upgrading

What a release changes that needs your hand: settings, tool names, metric names and, for a server of
your own, its packages and files. Read the page of every release between the one you run and the one
you take, oldest first; a release without a page needs nothing beyond its new version.

| Release                      | What needs your hand                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| [0.26](upgrading-to-0-26.md) | `analytics_engine_health` reports `metricsState`, engine URLs are the REST root, one BPMN engine pick |
| [0.25](upgrading-to-0-25.md) | camunda7 is engine (settings, tools, metrics, packages), OAuth from `MCP_USE_OAUTH_*`, a new starter  |

Every change of a release, the CLI's and the VS Code extension's included, is in the
[changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) and the
[releases](https://github.com/Miragon/pulse/releases).

## The image

Take the new tag of `ghcr.io/miragon/pulse-server` and change the settings its page names. The boot
refuses a setting a release retired and names the replacement, so a failed boot says what to change.
Upgrade the engines' metrics plugin with the server when the release's page says so.

## A server of your own

A repository made from [pulse-starter](https://github.com/Miragon/pulse-starter) shares no history
with it, so `git pull` brings nothing. The starter's skill
[upgrade-pulse](https://github.com/Miragon/pulse/blob/main/templates/composed-server/.claude/skills/upgrade-pulse/SKILL.md)
takes a release in one change: the starter's diff between the two releases (the mirror commits each
release once), replayed on your own modules, every `@miragon/pulse-*` pin and the libraries they are
built with at the release's versions, then the bar (build, typecheck, test) and one boot. Its steps
work by hand too. A dependency bot never moves one of these packages alone: the starter's README has
a Dependabot setup that leaves them to the skill.
