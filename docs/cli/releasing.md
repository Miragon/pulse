# Releasing

The CLI has no release of its own: every Pulse release ships it, in lockstep with the server
and the packages. release-please opens the release pull request from the conventional commits
on `main` and bumps `apps/cli/package.json` and the plugin manifest
`apps/cli/skills/pulse-cli/.claude-plugin/plugin.json` with the rest (`release-please-config.json`).
Merging it tags `v<version>`, and once someone approves "Await release approval" (the `release`
environment), `.github/workflows/release-please.yml` publishes every channel from the commit of
that run:

| Channel                     | Workflow                                    | What it publishes                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm `@miragon/pulse-cli`    | `.github/workflows/publish-npm-package.yml` | The tarball `pnpm pack` builds, published with npm trusted publishing (OIDC, no token) and provenance                                                                                                                                                       |
| GitHub release              | `.github/workflows/publish-cli.yml`         | `pulse-cli-<os>-<arch>` for Linux x64 and arm64, macOS x64 and arm64 and Windows x64 (`.exe`), each built and smoke-tested on its native runner, the macOS and Linux ones also as `.tar.xz`, plus `pulse-cli-SHA256SUMS` and a build provenance attestation |
| `ghcr.io/miragon/pulse-cli` | `.github/workflows/publish-cli.yml`         | linux/amd64 and linux/arm64, tagged `<version>`, `<major>.<minor>` and `latest` (a prerelease only `<version>`), with SBOM, provenance and an attestation                                                                                                   |
| `miragon/tap/pulse-cli`     | `.github/workflows/publish-homebrew.yml`    | Stable releases only: the formula from `apps/cli/scripts/homebrew-formula.sh`, installed, tested and audited on macOS and Linux, then squash-merged into [Miragon/homebrew-tap](https://github.com/Miragon/homebrew-tap)                                    |

The jobs that build hold read access only; the jobs that hold a token (the asset upload, the
attestations, the image push, the tap update) install nothing. `pnpm lint:github` pins that
shape, and that no publish job runs before the approval or after a rejected one.

## Dry run and re-runs

`gh workflow run release-please.yml -f dry_run=true` (with `--ref <branch>` for a branch) builds
and smoke-tests the bundle, the five executables and the image, counts the nine assets and packs
every npm package, after the same approval. It publishes nothing and skips Homebrew.

When a publish fails after the release exists, fix the cause and re-run the failed jobs of the
Release run: npm skips a version that already carries this repository's provenance, the assets
are replaced, the image tags are pushed again and a tap that holds the formula is left alone.
`gh workflow run publish-homebrew.yml -f version=<version>` publishes the formula of an existing
release again (`-f dry-run=true` only checks it).

## Check a release

```sh
gh release view v0.22.0 --repo Miragon/pulse --json assets --jq '.assets[].name'
gh release download v0.22.0 --repo Miragon/pulse --pattern pulse-cli-linux-x64
gh attestation verify pulse-cli-linux-x64 --repo Miragon/pulse
gh attestation verify oci://ghcr.io/miragon/pulse-cli:0.22.0 --repo Miragon/pulse
npm view @miragon/pulse-cli@0.22.0 dist.attestations.url
```

## One-time setup

1. **npm package.** A trusted publisher needs an existing package. An owner of the npm
   organization publishes a placeholder once (`0.0.0-bootstrap.0` under the dist-tag
   `bootstrap`, a package.json and a README only, no code), then adds the trusted publisher:
   `npm trust github @miragon/pulse-cli --file release-please.yml --repo Miragon/pulse --env npm --allow-publish`.
   The file is the calling workflow. A new configuration expires unless a publish through it
   succeeds within 48 hours, so the release follows right away.
2. **After the first release:** remove the `bootstrap` dist-tag, deprecate the placeholder and set
   "Require two-factor authentication and disallow tokens" under the package's publishing access.
3. **Image.** GHCR creates `ghcr.io/miragon/pulse-cli` private. An organization owner makes it
   public once, after the first push (package settings, Change visibility), and checks that
   Miragon/pulse has the role Write under "Manage Actions access".
4. **Release assets** need "immutable releases" off: release-please creates the release before
   the executables exist.
5. **Homebrew** uses the Miragon release-please app (`RELEASE_PLEASE_APP_CLIENT_ID`,
   `RELEASE_PLEASE_APP_PRIVATE_KEY`), installed on Miragon/homebrew-tap with write access to
   contents and pull requests. Its first publish also renames the formula the CLI had before
   (see [Homebrew](./installation#homebrew)), so `brew upgrade` moves existing installations,
   and the formula links the old command to `pulse-cli` until the first release after
   2027-01-31.
