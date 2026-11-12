import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The C7 adapter names a CLI command in the move refusals of Pulse for VS Code and Pulse for Orca
 * (`PulseCli`) and quotes its words as the CLI quotes the words of its own ready commands
 * (`shellWord` in the CLI's workflow views). No package imports an app, so the adapter keeps a
 * copy of the rule: the pattern of a word that needs no quotes and the single quotes around any
 * other. This guard holds the copy to the CLI's rule, both lines word for word.
 */

/** The CLI's rule and the adapter's copy. */
const CLI = "apps/cli/src/workflow/shell.ts"
const COPY = "packages/connectors/c7/c7-adapter/src/cli/pulse-cli.ts"

/** The pattern of a plain word, and the quoting of any other word. */
const PLAIN = /^const PLAIN = (\/.+\/)$/m
const QUOTED = /\bPLAIN\.test\(value\) \? value : (.+)$/m

/**
 * The rule a file states, or the parts it does not state where this guard reads them.
 * @param {string} text
 */
function quotingOf(text) {
  return { plain: PLAIN.exec(text)?.[1], quoted: QUOTED.exec(text)?.[1] }
}

const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8")

describe("the adapter quotes a word of its CLI command as the CLI does", () => {
  it("finds the rule where each file states it", () => {
    for (const file of [CLI, COPY]) {
      const { plain, quoted } = quotingOf(read(file))
      assert.ok(plain !== undefined && quoted !== undefined, `${file} states no rule here`)
    }
  })

  it("holds the copy to the CLI's rule, word for word", () => {
    assert.deepEqual(quotingOf(read(COPY)), quotingOf(read(CLI)))
  })

  it("tells a copy that quotes otherwise", () => {
    const cli = read(CLI)
    const plainer = cli.replace("[\\w.:@/+=-]", "[\\w@%+=:,./\\\\-]")
    const doubled = cli.replace("`'${value.replaceAll(", '`"${value.replaceAll(')
    for (const copy of [plainer, doubled]) {
      assert.notDeepEqual(quotingOf(copy), quotingOf(cli))
    }
  })
})
