import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { repoTextFiles } from "./check-package-scripts.mjs"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * A trace of @miragon/pulse-http shows the secrets of a request only on a platform that sets
 * `revealSecrets`, and only the CLI may set it, for a person who passed --show-secrets (owner
 * decision 2026-11-10). The MCP server, the runtime view, the C7 adapter, Pulse for VS Code and
 * Pulse for Orca never do: their traces, if they keep one, go to logs other people read. This
 * guard reads every tracked code file and fails on the option's name outside the package that
 * defines it and the CLI's sources.
 */

/** The option's name. */
const NAME = "revealSecrets"
const OPTION = new RegExp(String.raw`\b${NAME}\b`)

/**
 * Where the name must stand, so that renaming the option past this guard turns it red rather than
 * blind: the package's declaration.
 */
const ANCHORS = [
  [
    "packages/core/http/src/types.ts",
    new RegExp(String.raw`^\s*readonly ${NAME}\?: boolean$`, "m"),
  ],
]

/** Where the name may stand: the package itself, the CLI's src and this guard. */
const ADMITTED = [
  /^packages\/core\/http\//,
  /^apps\/cli\/src\//,
  /^scripts\/trace-secrets\.test\.mjs$/,
]

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * Every code file outside ADMITTED that names the option, as `file:line: text`.
 * @param {readonly { file: string, text: string }[]} files
 */
function revealingLines(files) {
  return files
    .filter(({ file }) => CODE.test(file) && !ADMITTED.some((admitted) => admitted.test(file)))
    .flatMap(({ file, text }) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          OPTION.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
        ),
    )
}

describe("only the CLI reveals the secrets of a trace", () => {
  const set = "const platform = { fetch, now, trace, revealSecrets: true }"
  for (const [file, count] of [
    ["apps/mcp-server/src/app.ts", 1],
    ["packages/connectors/engine/engine-connector/src/lib/engine/engine-connection.ts", 1],
    ["packages/core/runtime-view/src/host-kit/connection.ts", 1],
    ["packages/connectors/c7/c7-adapter/src/http.ts", 1],
    ["apps/vscode/src/host/engine.ts", 1],
    ["apps/orca/src/main.ts", 1],
    ["apps/orca/test/main.test.ts", 1],
    ["apps/cli/test/support/fake-runtime.ts", 1],
    ["apps/cli/src/http/client.ts", 0],
    ["packages/core/http/src/types.ts", 0],
    ["packages/core/http/test/trace.test.ts", 0],
    ["apps/mcp-server/README.md", 0],
  ]) {
    it(`${file} gives ${count} hit(s)`, () => {
      assert.equal(revealingLines([{ file, text: `const a = 1\n${set}\n` }]).length, count)
    })
  }

  it("names the file and the line of a hit, not a longer name", () => {
    const text = "const a = 1\n  platform.revealSecrets = true \nconst revealSecretsLater = 2\n"
    assert.deepEqual(revealingLines([{ file: "apps/orca/src/x.ts", text }]), [
      "apps/orca/src/x.ts:2: platform.revealSecrets = true",
    ])
  })

  for (const [file, anchor] of ANCHORS) {
    it(`reads the name ${file} uses`, () => {
      assert.match(readFileSync(join(REPO_ROOT, file), "utf8"), anchor)
    })
  }

  it("no file of the tree sets it outside the CLI", () => {
    assert.deepEqual(revealingLines(repoTextFiles(REPO_ROOT)), [])
  })
})
