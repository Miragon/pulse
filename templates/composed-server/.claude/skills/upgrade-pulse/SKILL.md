---
name: upgrade-pulse
description: Take a new Pulse release into this repository in one change, the `@miragon/pulse-*` packages, the libraries they are built with and the starter's own files together. Use whenever upgrading or updating Pulse, bumping `@miragon/pulse-*` or `mcp-use`, syncing with pulse-starter, or when a dependency bot proposes one of these packages on its own.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# upgrade-pulse: one Pulse release, all at once

This repository was created from
[Miragon/pulse-starter](https://github.com/Miragon/pulse-starter) and shares
no history with it, so `git pull` or `git merge` from the starter brings
nothing. A Pulse release moves three things together, and they move in ONE
change:

- the `@miragon/pulse-*` packages, one version in every `package.json` (each
  module carries its own pins);
- the libraries they are built with: `mcp-use` (exact, even as a peer),
  `react`, `react-dom`, `zod`, `lucide-react`, `@tanstack/react-query`, and the
  dev pins that follow `mcp-use` (`@mcp-use/client`,
  `@modelcontextprotocol/client`);
- the starter's own files: `server/src/`, the guard tests in `server/test/`,
  the configs, `.env.example`, `CLAUDE.md` and the skills.

Never take one of them alone, a dependency bot's pull request included: a
second `mcp-use` or React instance hangs every widget on "Loading…"
(`CLAUDE.md`, invariants 4 and 5).

## Step 1: from which release, to which

```bash
grep '"@miragon/pulse-widget-shell"' server/package.json   # the release you run
pnpm view @miragon/pulse-widget-shell version              # the newest release
```

Take the newest unless the user names one. Then read what each release in
between asks of you, oldest first:
[Upgrading](https://miragon.github.io/pulse/mcp/upgrading) has a page for
every release that breaks something (settings, tool names, exports), the
[changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) lists
the rest. Note what reaches beyond the starter's files: a renamed setting in
your deployment, a tool name in a hook or an allowlist, an export your own
module imports.

## Step 2: the starter's changes as one patch

The mirror commits every release once, as
`chore: sync from Miragon/pulse v<version>`; the diff of two such commits is
everything the starter changed in between. Start from a clean working tree
(`git apply -3` works on the index), then, with your two versions:

```bash
git remote add pulse-starter https://github.com/Miragon/pulse-starter.git  # once
git fetch pulse-starter
FROM=$(git log pulse-starter/main --format=%H --grep=' v0.25.0$')
TO=$(git log pulse-starter/main --format=%H --grep=' v0.26.0$')
echo "$FROM $TO"   # one commit each
git diff "$FROM" "$TO" -- . ':!pnpm-lock.yaml' ':!.github' > ../pulse-upgrade.patch
git apply -3 ../pulse-upgrade.patch
```

- `pnpm-lock.yaml` stays out (Step 4 regenerates it), and so does `.github`
  (the mirror's own `CODEOWNERS`).
- A path you deleted stops the whole apply, and nothing is written
  (`does not exist in index`): add it to the excludes, `':!modules/mcp-notes'`
  for the example module, and still replay its part in Step 3.
- The fetch brought the starter's files, so `git apply -3` merges where you
  changed a file too. Where both sides changed the same lines (your scope
  next to a bumped pin in `server/package.json`, your text next to the
  mirror's version banner in `README.md`), it exits 1 and leaves conflict
  markers: `git diff --name-only --diff-filter=U` lists the files. Keep your
  names and your code, take the release's versions and changes, then
  `git add` each file.

## Step 3: your own modules

The patch changes `modules/mcp-notes` only, but every module you copied from
it carries the same pins and scaffolding. Replay the example's part on each
of yours, here `modules/mcp-crm`:

```bash
git diff --relative=modules/mcp-notes "$FROM" "$TO" > ../example.patch
git apply -3 --directory=modules/mcp-crm ../example.patch
```

Resolve its conflicts like Step 2's. A hunk that does not fit what your
module became (a file you rewrote or removed) is yours to port by hand or
leave out; read the example's diff for it. Change your code where the
release's page names an export you use. Then list every pin of the lockstep:

```bash
grep -rnE --include=package.json --exclude-dir=node_modules \
  '"(@miragon/pulse-[a-z-]+|mcp-use|@mcp-use/client|@modelcontextprotocol/client|react|react-dom|zod|lucide-react|@tanstack/react-query)": "' . |
  sort -t'"' -k2,2
```

Every `@miragon/pulse-*` names the new version, exact or as a `^` peer, and
each library has one exact version across the files (a peer keeps its
range).

## Step 4: install, the bar, one boot

```bash
pnpm install                                # regenerates pnpm-lock.yaml
pnpm build && pnpm typecheck && pnpm test   # the bar (CLAUDE.md, Verification)
pnpm dev                                    # one boot: read its log
```

An unmet-peer warning from `pnpm install` is no reason to move a pin off the
release's version. The boot refuses a setting the release retired and names
its replacement: fix `.env` and every other source of the deployment's
environment (secrets, compose files, manifests) the same way. A warning about
an unknown variable names one the release no longer reads. Render one widget
in the inspector (`http://localhost:8400/mcp/inspector`) to see the new
bundle work.

## Step 5: commit

One commit for the release: the patch, your modules' pins, the conflicts you
resolved and the new `pnpm-lock.yaml`, named after the release
(`chore: upgrade Pulse to 0.26.0`). The pins are where the next upgrade reads
its starting point.
