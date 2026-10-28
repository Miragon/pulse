# Installation

Four ways, the same CLI: the npm package (Node.js >= 22.12), Homebrew, a standalone executable
for machines without Node.js, or the container image.

## npm

```sh
npm install -g @miragon/pulse-cli
pulse-cli --version
npx @miragon/pulse-cli --help
```

## Homebrew

On macOS and Linux, from the [Miragon tap](https://github.com/Miragon/homebrew-tap):

```sh
brew install miragon/tap/pulse-cli
pulse-cli --version
```

The formula installs the [standalone executable](#standalone-executable) (no Node.js needed).
`brew upgrade pulse-cli` updates it.

## Standalone executable

Every [GitHub release](https://github.com/Miragon/pulse/releases) of the CLI has one file per
platform that embeds Node.js 24, plus `pulse-cli-SHA256SUMS`:

| Platform              | File                        | Requires                                                 |
| --------------------- | --------------------------- | -------------------------------------------------------- |
| Linux x64             | `pulse-cli-linux-x64`       | glibc >= 2.28 (Debian 10, Ubuntu 20.04, RHEL 8 or newer) |
| Linux arm64           | `pulse-cli-linux-arm64`     | glibc >= 2.28                                            |
| macOS (Apple silicon) | `pulse-cli-macos-arm64`     | macOS 13.5 or newer                                      |
| macOS (Intel)         | `pulse-cli-macos-x64`       | macOS 13.5 or newer                                      |
| Windows x64           | `pulse-cli-windows-x64.exe` | Windows 10 or Server 2016 or newer                       |

Each macOS and Linux file also comes as `<file>.tar.xz` (about 25 MB instead of 125 MB). On Alpine and other musl based systems, use the container image or the npm package.

```sh
base=https://github.com/Miragon/pulse/releases/latest/download
curl -fL -O "$base/pulse-cli-linux-x64" -O "$base/pulse-cli-SHA256SUMS"
sha256sum --check --ignore-missing pulse-cli-SHA256SUMS
sudo install -m 0755 pulse-cli-linux-x64 /usr/local/bin/pulse-cli
pulse-cli --version
gh attestation verify pulse-cli-linux-x64 --repo Miragon/pulse
```

- `latest/download` follows the newest release; `download/v<version>/<file>` pins one. On macOS
  check with `shasum -a 256 --check --ignore-missing pulse-cli-SHA256SUMS`.
- **macOS**: the binaries are signed ad hoc, not notarized. A file downloaded with a browser is
  blocked; run `xattr -d com.apple.quarantine pulse-cli-macos-arm64` or allow it under System
  Settings → Privacy & Security.
- **Windows**: compare `(Get-FileHash pulse-cli-windows-x64.exe).Hash` in PowerShell with its line
  in `pulse-cli-SHA256SUMS`. The file is not Authenticode signed, so SmartScreen may warn.
- **Certificates and proxies**: `NODE_EXTRA_CA_CERTS=/path/ca.pem` or `NODE_USE_SYSTEM_CA=1` for an
  internal CA, `NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` / `NO_PROXY` for a proxy. The same holds
  for the container image.
- `pulse-cli auth login` works on a server over SSH, see [OAuth](authentication.md#oauth).

## Container image

`ghcr.io/miragon/pulse-cli` for `linux/amd64` and `linux/arm64`, tagged `<version>`,
`<major>.<minor>` and `latest`. It runs on distroless Node.js 24 as a non-root user (uid 65532),
without a shell. Arguments after the image name go to `pulse-cli`; without `-t` the output is JSON.

```sh
docker run --rm ghcr.io/miragon/pulse-cli --version

# An engine on the Docker host (--add-host is needed on Linux)
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e PULSE_CLI_URL=http://host.docker.internal:8080/engine-rest \
  ghcr.io/miragon/pulse-cli ping

# Credentials from the calling shell: -e NAME without a value passes the variable on
docker run --rm -e PULSE_CLI_URL -e PULSE_CLI_USERNAME -e PULSE_CLI_PASSWORD \
  ghcr.io/miragon/pulse-cli process-instance list --max-results 10

# Files of the current directory: mount it at /work and run as your own user
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -e PULSE_CLI_URL \
  ghcr.io/miragon/pulse-cli deployment create invoice.bpmn

# Profiles of your config file
docker run --rm -it --user "$(id -u):$(id -g)" -v "$HOME/.config/pulse-cli:/config:ro" \
  -e PULSE_CLI_CONFIG=/config/config.json ghcr.io/miragon/pulse-cli --profile prod status
```

- `pulse-cli auth login` and token commands do not work in the container: use Basic auth or pass a
  token with `-e PULSE_CLI_TOKEN`.
- A project file (`.pulse-cli.json`) in the mounted `/work` directory is used as on the host.
- Each image carries an SBOM and SLSA provenance;
  `gh attestation verify oci://ghcr.io/miragon/pulse-cli:<version> --repo Miragon/pulse` verifies
  it.

## Compatibility

pulse-cli works with Operaton, CIB seven and Camunda 7. The tested versions and how to choose the
engine: [Engines](engines.md).
