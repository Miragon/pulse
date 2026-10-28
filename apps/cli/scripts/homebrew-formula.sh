#!/usr/bin/env bash
# Writes the Homebrew formula of the Pulse CLI (Miragon/homebrew-tap, Formula/pulse-cli.rb) to
# stdout: the .tar.xz archives of the standalone executables of one Pulse release for macOS and
# Linux, no dependencies, checksums from that release's pulse-cli-SHA256SUMS.
#
#   gh release download v0.22.0 --repo Miragon/pulse --pattern pulse-cli-SHA256SUMS
#   apps/cli/scripts/homebrew-formula.sh 0.22.0 pulse-cli-SHA256SUMS > pulse-cli.rb
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <version> <pulse-cli-SHA256SUMS file>" >&2
  exit 2
fi

version="$1"
checksums="$2"
base="https://github.com/Miragon/pulse/releases/download/v${version}"

checksum() {
  local sum
  sum="$(awk -v file="$1" '$2 == file || $2 == "*" file { print $1 }' "$checksums")"
  if [ -z "$sum" ]; then
    echo "$checksums has no checksum of $1" >&2
    exit 1
  fi
  echo "$sum"
}

# Each checksum before the heredoc: a failed command substitution inside one does not stop the
# script, and the formula would carry an empty sha256.
macos_arm64="$(checksum pulse-cli-macos-arm64.tar.xz)"
macos_x64="$(checksum pulse-cli-macos-x64.tar.xz)"
linux_arm64="$(checksum pulse-cli-linux-arm64.tar.xz)"
linux_x64="$(checksum pulse-cli-linux-x64.tar.xz)"

cat <<EOF
class PulseCli < Formula
  desc "AI-first CLI for the Camunda 7 REST API (Operaton, CIB seven, Camunda 7)"
  homepage "https://miragon.github.io/pulse/cli/"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/pulse-cli-macos-arm64.tar.xz"
      sha256 "${macos_arm64}"
    end
    on_intel do
      url "${base}/pulse-cli-macos-x64.tar.xz"
      sha256 "${macos_x64}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/pulse-cli-linux-arm64.tar.xz"
      sha256 "${linux_arm64}"
    end
    on_intel do
      url "${base}/pulse-cli-linux-x64.tar.xz"
      sha256 "${linux_x64}"
    end
  end

  def install
    bin.install "pulse-cli"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/pulse-cli --version").strip
  end
end
EOF
