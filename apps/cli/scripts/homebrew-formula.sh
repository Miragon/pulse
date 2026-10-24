#!/usr/bin/env bash
# Writes the Homebrew formula of operate (Miragon/homebrew-tap, Formula/operate.rb) to stdout: the
# .tar.xz archives of the standalone executables of one GitHub release for macOS and Linux, no
# dependencies, checksums from the SHA256SUMS of that release.
#
#   gh release download v0.8.0 --pattern SHA256SUMS
#   scripts/homebrew-formula.sh 0.8.0 SHA256SUMS > operate.rb
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <version> <SHA256SUMS file>" >&2
  exit 2
fi

version="$1"
checksums="$2"
base="https://github.com/Miragon/operate/releases/download/v${version}"

checksum() {
  local sum
  sum="$(awk -v file="$1" '$2 == file || $2 == "*" file { print $1 }' "$checksums")"
  if [ -z "$sum" ]; then
    echo "$checksums has no checksum of $1" >&2
    exit 1
  fi
  echo "$sum"
}

cat <<EOF
class Operate < Formula
  desc "AI-first CLI for the Camunda 7 REST API (Operaton, CIB seven, Camunda 7)"
  homepage "https://github.com/Miragon/operate"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/operate-macos-arm64.tar.xz"
      sha256 "$(checksum operate-macos-arm64.tar.xz)"
    end
    on_intel do
      url "${base}/operate-macos-x64.tar.xz"
      sha256 "$(checksum operate-macos-x64.tar.xz)"
    end
  end

  on_linux do
    on_arm do
      url "${base}/operate-linux-arm64.tar.xz"
      sha256 "$(checksum operate-linux-arm64.tar.xz)"
    end
    on_intel do
      url "${base}/operate-linux-x64.tar.xz"
      sha256 "$(checksum operate-linux-x64.tar.xz)"
    end
  end

  def install
    bin.install "operate"
    generate_completions_from_executable(bin/"operate", "completion")
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/operate --version").strip
  end
end
EOF
