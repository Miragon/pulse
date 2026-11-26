// @ts-check
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import picomatch from "picomatch"
import ts from "typescript"
import { REPO_SCRIPTS } from "../eslint.config.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The scripts tsc does not pass yet without JSDoc types written for them (F71, #688), each
 * listed until it says `// @ts-check`. The list only shrinks: an entry fails once its file says it
 * or is gone, and a script that is not listed says it, a new one from its first commit.
 */
const NOT_YET_CHECKED = [
  "scripts/artifact-tools.test.mjs",
  "scripts/check-github-config.test.mjs",
  "scripts/check-package-naming.test.mjs",
  "scripts/check-package-scripts.test.mjs",
  "scripts/check-ratchets.mjs",
  "scripts/check-ratchets.test.mjs",
  "scripts/dependency-cruiser-gates.test.mjs",
  "scripts/docs-refs.test.mjs",
  "scripts/editor-projects.test.mjs",
  "scripts/entry-lists.test.mjs",
  "scripts/eslint-effective-config.test.mjs",
  "scripts/eslint-gates.test.mjs",
  "scripts/local-args.test.mjs",
  "scripts/local-env.test.mjs",
  "scripts/local-gradle.test.mjs",
  "scripts/local-test-one.test.mjs",
  "scripts/local.mjs",
  "scripts/published-imports.test.mjs",
  "scripts/root-incident-rule.test.mjs",
  "scripts/template-pins.test.mjs",
  "scripts/third-party-licenses.mjs",
  "scripts/third-party-licenses.test.mjs",
  "scripts/trace-secrets.test.mjs",
]

/** `// @ts-check` as tsc reads it: the first line, or the one after a shebang. */
const TS_CHECK = /^(?:#![^\n]*\n)?\/\/ @ts-check\r?\n/

/** Every file REPO_SCRIPTS names (the root and scripts/ hold them), repo-relative. */
function repoScripts() {
  const isScript = picomatch(REPO_SCRIPTS, { dot: true })
  return [
    ...fs.readdirSync(repoRoot),
    ...fs.readdirSync(path.join(repoRoot, "scripts")).map((name) => `scripts/${name}`),
  ]
    .filter((rel) => isScript(rel))
    .sort()
}

const saysTsCheck = (rel) => TS_CHECK.test(fs.readFileSync(path.join(repoRoot, rel), "utf8"))

describe("every script says // @ts-check, the ones not yet typed aside (pnpm typecheck:scripts)", () => {
  const scripts = repoScripts()

  it("finds the scripts and the dependency rules", () => {
    assert.ok(scripts.includes("scripts/check-ratchets.mjs"), scripts.join(", "))
    assert.ok(scripts.includes(".dependency-cruiser.cjs"), scripts.join(", "))
  })

  it("a script that does not say it is listed in NOT_YET_CHECKED", () => {
    const unchecked = scripts.filter((rel) => !NOT_YET_CHECKED.includes(rel) && !saysTsCheck(rel))
    assert.deepEqual(unchecked, [], "start the file with `// @ts-check` (after a shebang)")
  })

  it("an entry of NOT_YET_CHECKED is a script that does not say it yet", () => {
    const stale = NOT_YET_CHECKED.filter((rel) => !scripts.includes(rel) || saysTsCheck(rel))
    assert.deepEqual(stale, [], "the file says // @ts-check or is gone: drop it from the list")
  })

  it("tsc reads every script, and `pnpm lint` runs it", () => {
    const tsconfig = path.join(repoRoot, "scripts/tsconfig.json")
    const parsed = ts.getParsedCommandLineOfConfigFile(
      tsconfig,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        },
      },
    )
    assert.ok(parsed, tsconfig)
    const read = new Set(parsed.fileNames.map((file) => path.relative(repoRoot, file)))
    const unread = scripts.filter((rel) => !read.has(rel))
    assert.deepEqual(unread, [], "scripts/tsconfig.json's `include` misses them")
    const { scripts: root } = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    )
    assert.equal(root["typecheck:scripts"], "tsc -p scripts/tsconfig.json")
    assert.ok(root.lint.split(" && ").includes("pnpm typecheck:scripts"), root.lint)
  })
})
