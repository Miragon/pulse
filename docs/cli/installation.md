# Installation

Four ways, the same CLI: the npm package (Node.js >= 22.12), Homebrew, a standalone executable
for machines without Node.js, or the container image.

## npm

```sh
npm install -g @miragon/operate
operate --version
npx @miragon/operate --help
```

## Homebrew

On macOS and Linux, from the [Miragon tap](https://github.com/Miragon/homebrew-tap):

```sh
brew install miragon/tap/operate
operate --version
```

The formula installs the [standalone executable](#standalone-executable) (no Node.js needed) and
the [shell completion](#shell-completion). `brew upgrade operate` updates it.

## Standalone executable

Every [GitHub release](https://github.com/Miragon/operate/releases) after 0.5.0 has one file per
platform that embeds Node.js 24, plus `SHA256SUMS`:

| Platform              | File                      | Requires                                                 |
| --------------------- | ------------------------- | -------------------------------------------------------- |
| Linux x64             | `operate-linux-x64`       | glibc >= 2.28 (Debian 10, Ubuntu 20.04, RHEL 8 or newer) |
| Linux arm64           | `operate-linux-arm64`     | glibc >= 2.28                                            |
| macOS (Apple silicon) | `operate-macos-arm64`     | macOS 13.5 or newer                                      |
| macOS (Intel)         | `operate-macos-x64`       | macOS 13.5 or newer                                      |
| Windows x64           | `operate-windows-x64.exe` | Windows 10 or Server 2016 or newer                       |

Releases after 0.8.0 also have each macOS and Linux file as `<file>.tar.xz` (about 25 MB instead
of 125 MB). On Alpine and other musl based systems, use the container image or the npm package.

```sh
base=https://github.com/Miragon/operate/releases/latest/download
curl -fL -O "$base/operate-linux-x64" -O "$base/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
sudo install -m 0755 operate-linux-x64 /usr/local/bin/operate
operate --version
gh attestation verify operate-linux-x64 --repo Miragon/operate
```

- `latest/download` follows the newest release; `download/v<version>/<file>` pins one. On macOS
  check with `shasum -a 256 --check --ignore-missing SHA256SUMS`.
- **macOS**: the binaries are signed ad hoc, not notarized. A file downloaded with a browser is
  blocked; run `xattr -d com.apple.quarantine operate-macos-arm64` or allow it under System
  Settings → Privacy & Security.
- **Windows**: compare `(Get-FileHash operate-windows-x64.exe).Hash` in PowerShell with its line in
  `SHA256SUMS`. The file is not Authenticode signed, so SmartScreen may warn.
- **Certificates and proxies**: `NODE_EXTRA_CA_CERTS=/path/ca.pem` or `NODE_USE_SYSTEM_CA=1` for an
  internal CA, `NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` / `NO_PROXY` for a proxy. The same holds
  for the container image.
- `operate auth login` works on a server over SSH, see [OAuth](authentication.md#oauth).

## Container image

`ghcr.io/miragon/operate` for `linux/amd64` and `linux/arm64`, tagged `<version>`,
`<major>.<minor>` and `latest`. It runs on distroless Node.js 24 as a non-root user (uid 65532),
without a shell. Arguments after the image name go to `operate`; without `-t` the output is JSON.

```sh
docker run --rm ghcr.io/miragon/operate --version

# An engine on the Docker host (--add-host is needed on Linux)
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e OPERATE_URL=http://host.docker.internal:8080/engine-rest \
  ghcr.io/miragon/operate ping

# Credentials from the calling shell: -e NAME without a value passes the variable on
docker run --rm -e OPERATE_URL -e OPERATE_USERNAME -e OPERATE_PASSWORD \
  ghcr.io/miragon/operate process-instance list --max-results 10

# Files of the current directory: mount it at /work and run as your own user
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -e OPERATE_URL \
  ghcr.io/miragon/operate deployment create invoice.bpmn

# Profiles of your config file
docker run --rm -it --user "$(id -u):$(id -g)" -v "$HOME/.config/operate:/config:ro" \
  -e OPERATE_CONFIG=/config/config.json ghcr.io/miragon/operate --profile prod status
```

- `operate auth login` and token commands do not work in the container: use Basic auth or pass a
  token with `-e OPERATE_TOKEN`.
- A project file (`.operate.json`) in the mounted `/work` directory is used as on the host.
- Each image carries an SBOM and SLSA provenance;
  `gh attestation verify oci://ghcr.io/miragon/operate:<version> --repo Miragon/operate` verifies
  it.

## Compatibility

operate works with Operaton, CIB seven and Camunda 7. The tested versions and how to choose the
engine: [Engines](engines.md).

## Shell completion

`operate completion <bash|zsh|fish>` prints a completion script for commands, options, fixed
values and profile names. It never contacts the engine, so ids are not completed.

```sh
eval "$(operate completion bash)"
mkdir -p ~/.zfunc && operate completion zsh > ~/.zfunc/_operate
operate completion fish > ~/.config/fish/completions/operate.fish
```

Put the bash line into `~/.bashrc`. For zsh add `fpath=(~/.zfunc $fpath)` to `~/.zshrc` before
`compinit`.
