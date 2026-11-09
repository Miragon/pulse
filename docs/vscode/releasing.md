# Releasing

The extension has no release of its own: every Pulse release ships it, in lockstep with the
server, the CLI and the packages. release-please bumps `apps/vscode/package.json` with the rest,
and once someone approves "Await release approval" (the `release` environment),
`.github/workflows/release-please.yml` calls `.github/workflows/publish-vscode-extension.yml`:

| Job     | What it does                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package | Builds and packs the `.vsix` with read access only, and refuses a version that is not the release tag                                                                                                            |
| publish | In the environment `vscode-marketplace` (`main` only): installs nothing but the lockfile's vsce and ovsx, builds nothing and publishes that `.vsix` to the Visual Studio Marketplace and Open VSX, plain release |
| attach  | Uploads the `.vsix` to the GitHub release                                                                                                                                                                        |

Both stores publish by trusted publishing: the publish job's GitHub OIDC token (`id-token: write`)
is traded for a short-lived publishing token (`vsce publish --oidc`,
`ovsx publish --trusted-publishing`), so the repository stores no token for either.
`pnpm lint:github` pins that shape: no secret anywhere in the workflow, both flags on the
publish commands. Both publish with `--skip-duplicate`, so re-running a failed publish job
publishes only what is missing.

## Trusted publishing on both stores

Each store binds its trusted publisher to four values. The workflow is the **calling** file,
`release-please.yml`, not the reusable `publish-vscode-extension.yml`; the environment is that
of the publish job:

| Field            | Value                |
| ---------------- | -------------------- |
| Repository owner | `Miragon`            |
| Repository       | `pulse`              |
| Workflow         | `release-please.yml` |
| Environment      | `vscode-marketplace` |

Renaming `release-please.yml` or the environment breaks publishing until both stores are updated.

- **Visual Studio Marketplace** (vsce 4.1.0 or later): one Trusted Publishing policy on the
  publisher `miragon-gmbh` (publisher management page, Trusted Publishing, Create), a policy of
  its own next to Miragon/modeler-suite's.
- **Open VSX** (ovsx 1.3.0 or later): one trusted publisher for the extension, registered by a
  namespace owner of `miragon-gmbh` under Settings, Trusted Publishers
  (https://open-vsx.org/user-settings/trusted-publishers): namespace `miragon-gmbh`, extension
  `pulse-cockpit`, provider GitHub Actions, the values above. Open VSX matches the token's
  `workflow_ref` claim, the calling workflow. A registration cannot be edited, only deleted and
  created again, and it binds only to an extension that exists; `pulse-cockpit` does.

The Marketplace documents the workflow field only as "the workflow filename under
`.github/workflows`". Should its exchange refuse the token, add a second policy with the workflow
`publish-vscode-extension.yml` and re-run the failed publish job.

## Dry run

`gh workflow run release-please.yml -f dry_run=true` packages and checks the `.vsix` after the
same approval and publishes nothing. Every pull request packages it too (CI job "VS Code package
(vsce dry run)").
