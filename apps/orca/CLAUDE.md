# CLAUDE.md (apps/orca)

Guidance for agents working on Pulse for Orca: the Orca plugin `pulse-cockpit`
(`@miragon/pulse-orca`), the runtime view of Pulse for VS Code inside Orca. It is an interface
app of the Pulse monorepo and the second editor host of the runtime view
(`packages/core/runtime-view`) and the C7 adapter (`packages/connectors/c7/c7-adapter`).
The repository's package rules hold here (the root `CLAUDE.md`), and so do the rules of
`apps/vscode/CLAUDE.md` for everything both hosts share (the house rules, the ADRs in
`apps/vscode/docs/adr/`); this file adds what is Orca's.

## Commands

Run them from the repository root.

```sh
pnpm --filter @miragon/pulse-orca run build      # the plugin folder apps/orca/dist, as Orca loads it
pnpm --filter @miragon/pulse-orca run typecheck  # tsc over the app, then the worker and the frames with their globals
pnpm --filter @miragon/pulse-orca run lint       # ESLint with the house rules of the editor hosts
pnpm --filter @miragon/pulse-orca test           # the worker against a fake Orca, coverage floors
pnpm --filter @miragon/pulse-orca run test:orca  # the typings against this Orca, then orca plugin validate + check over dist (needs Orca, or ORCA_RESOURCES)
pnpm --filter @miragon/pulse-orca run test:kit   # the panel and the worker on Orca's own test kit (orca/testing)
pnpm --filter @miragon/pulse-orca run test:smoke # build, load into the running Orca, read the sandbox engines, open a view
pnpm lint:architecture:orca                      # the closed-world dependency rules
```

`apps/orca/scripts/orca.mjs` runs the Orca CLI of the installed app (`/Applications/Orca.app`), or of the
release whose resources folder `ORCA_RESOURCES` names: CI extracts the pinned Orca .deb and runs
its CLI on plain Node. `types/` holds Orca's plugin typings as `orca plugin types` writes them for
that release; bump them together with `ORCA_VERSION` and `ORCA_DEB_SHA256` in
`.github/workflows/ci.yml` and `.github/workflows/publish-orca-plugin.yml`. The kit tests
(`test/kit/*.orca.test.ts`, `vitest.kit.config.ts`) resolve `orca` and `orca/testing` to that
release's own runtime files, so a panel test draws with Orca's components and a worker test
answers through Orca's mock host, which refuses what Orca refuses. `test:smoke` approves the
fingerprint of the plugin it just built, the developer's own folder, and needs the sandbox up.

To try the plugin in Orca, against the sandbox engines of the VS Code extension
(`pnpm --fail-if-no-match --filter pulse-cockpit run sandbox:up`):

```sh
O=/Applications/Orca.app/Contents/Resources/bin/orca
$O plugin dev load apps/orca/dist                 # prints the approval command with its fingerprint
$O plugin dev load apps/orca/dist --approve <fingerprint>
$O plugin dev request apps/orca/dist engines.setProjectFile \
  --data "{\"path\":\"$PWD/apps/vscode/sandbox/.pulse.json\"}"
$O plugin open local.pulse-cockpit
```

After a rebuild, `$O plugin dev reload apps/orca/dist` remounts open tabs; tabs and the panel
reconnect after `$O plugin restart local.pulse-cockpit`.

## Product shots

The cover and the screenshots in `apps/orca/images/` are the plugin's page in Orca's directory
(`cover`, `screenshots` in `orca-plugin.json`) and the pictures of `README.md`. The skill
`miragon-brand:product-shots` makes them from `.miragon/product-shots.yaml`: Orca in a Linux
container, the demo workspace `apps/orca/demo/` (a project file, a model and the tabs it opens) against the
sandbox's shop-dev, reached as `dev.shop.example`. With the sandbox up and the plugin built, from
the repository root:

```sh
podman run --rm --init -v "$PWD":/work -w /work -v "$PLUGIN":/plugin:ro \
  -v orca-cache:/orca-cache -e ORCA_CACHE=/orca-cache -e ORCA_VERSION=1.4.252 \
  --add-host dev.shop.example:host-gateway mcr.microsoft.com/playwright:v1.56.1-noble \
  bash -c 'npm i --silent --prefix /tmp/pw playwright-core@1.56.1 &&
    PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core xvfb-run -a -s "-screen 0 1920x1200x24" \
    node /plugin/skills/product-shots/scripts/listing.mjs --product pulse-orca'
```

`$PLUGIN` is the `miragon-brand` plugin folder. Make them again after a visible change of the
tabs or the panel and after an update of the skill (the version the config names), and copy the two light
screenshots to `docs/assets/orca/`.

## Where code goes

| You want to…                                                 | Put it in                                                                      | Never                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Anything both editor hosts show or decide                    | the runtime view or the adapter (`apps/vscode/CLAUDE.md`, "Where code goes")   | a copy here                                    |
| Wire the runtime view into Orca (requests, events, settings) | `apps/orca/src/worker`                                                         | business rules, the panel runtime `orca`       |
| The Pulse panel (engines tree, prompts, login, boards)       | `apps/orca/src/panel`, Orca's components                                       | `orca/worker`, the runtime view's code         |
| The frames of the custom editors (views, boards)             | `apps/orca/src/editor` (`bridge.ts` posts the webview's intents to the worker) | logic: the frame holds the webview bundle only |
| A message between the worker, the panel and the frames       | `apps/orca/src/protocol.ts` (`PluginRequests`, `PluginPanelEvents`)            | an untyped request name                        |
| A contribution (command, setting, editor, capability)        | `apps/orca/orca-plugin.json`                                                   | a capability the plugin does not use           |
| The engines and the model reader                             | `apps/orca/src/worker/composition-root.ts`, the one place that knows them      | an adapter import anywhere else                |

The dependency rules are closed-world (`apps/orca/.dependency-cruiser.cjs`): the worker uses the
runtime view's ports, core, protocol and host kit, the main entry of the engine contract
`@miragon/pulse-engine-core` (its ids and read models), `orca/worker` and Node built-ins; the panel
`orca` and the protocol's types; the frames the protocol's types; only the composition root the
adapter and the model reader. No part imports a dialect's core (`plugin-is-dialect-neutral`) or
the transport `@miragon/pulse-http`, which the C7 adapter's wire alone sends through (the
repository's `http-consumers`), over the worker's global `fetch`. The repository's licence list
(`scripts/third-party-licenses.mjs`), which the licence test reads, may use Node built-ins and
nothing else. `pnpm lint:architecture:orca` says where an import belongs.

The project file is `.pulse.json`, read through the host kit (`TargetsParser` over
`@miragon/pulse-profile`, the rules in `apps/vscode/CLAUDE.md`); `ProjectFile` of the host kit
names it and its former name, `.pulse-cli.json`, which the worker turns into one problem and no
engine. A project file that is there but can't be read is one problem too, and no local default
engine takes its place; only a missing file falls back to it. Logins are keyed by the project
file's path (the host kit's `CredentialStore`).

## Rules

- The house rules of the editor hosts hold here (`apps/vscode/CLAUDE.md`, Rules): no comments,
  classes, the budgets, strict TypeScript, English UI text in sentence case, ratchets one way.
- The plugin's own texts (worker, panel, editor frames) use the product's words and draw no glyph
  and no raw colour: pulse-ui's gates read them in `apps/orca/test/architecture/brand-gates.test.ts`,
  as the extension's read the runtime view's. They promise no later feature either, nor does
  the manifest: its promise scan runs the rules of Pulse for VS Code
  (`apps/orca/test/architecture/support/promise-words.ts`, a copy it holds word for word to the
  extension's, whose file `apps/orca/turbo.json` names as an input of the tests), and a state
  text such as "No boards yet." keeps its word only as an allowance with its reason.
- Writes follow the extension's policy (`WritePolicy`, `ConfirmationPolicy` of the host kit). A
  confirmation waits in the Pulse panel and only a request from the panel
  (`PanelCaller { surface: "panel", contributionId: "engines" }`, set by Orca) settles it; a tab's
  request is refused and logged. Every answer lands in the write audit (`orca plugin logs`).
- A frame never holds authority: it posts the webview's intents, and what it does itself (open a
  URL, copy) comes back from the worker as an action within the user's gesture.
- A request a frame or the panel holds open (a watch) answers within Orca's request timeout and
  ends when Orca aborts it: Orca has no close event, and `orca plugin check` waits for every
  request in flight.
- Commit messages are Conventional Commits with the scope `orca`. The catalog's release notes
  take the changelog lines of the scopes `orca`, `runtime-view` and `c7-adapter`
  (`apps/orca/scripts/release-notes.mjs`).
- A release publishes `dist` into `Miragon/orca-plugins` as `plugins/pulse-cockpit`, listed as
  `miragon.pulse-cockpit` (`.github/workflows/publish-orca-plugin.yml`). The id is that
  repository's `sources.json` entry and every installation's key: a new id is a new plugin.
  The publish is off for now (`publish: false` in `.github/workflows/release-please.yml`): a
  release builds and checks the plugin only, until `orca-plugins` admits it.
- `engines.orca` in the manifest names the Orca release CI pins, the oldest one tested.
- The plugin folder ships `LICENSE` and `THIRD_PARTY_LICENSES.txt` (`PLUGIN_FILES` of
  `apps/orca/scripts/build.mjs`; the release's folder check in
  `.github/workflows/publish-orca-plugin.yml` names both): the works of others esbuild bundles
  into the worker, the panel, the frames' bridge and the webview (packages, fonts, the Lucide
  geometry of `lucide-glyphs.json`) with their licence files, read from the metafiles of the four
  builds (`pluginBuilds`) by the repository's licence list (`scripts/third-party-licenses.mjs`).
  `apps/orca/test/third-party-licenses.test.ts` fails while it misses a work or lists one the
  bundles hold no more, so a bump of a bundled package writes it again in its pull request:
  `pnpm --fail-if-no-match --filter @miragon/pulse-orca third-party-licenses`.
