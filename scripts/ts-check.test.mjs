// @ts-check
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import picomatch from "picomatch"
import ts from "typescript"
import { REPO_SCRIPTS } from "../eslint.config.mjs"
import { isTypedScript, saysTsCheck as checkedByTsc } from "./check-ratchets.mjs"
import { readWorkspace } from "./workspace-packages.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The scripts tsc does not pass yet without JSDoc types written for them (F71, #688), each
 * listed until it says `// @ts-check`. The list only shrinks: an entry fails here once its file
 * says it or is gone, a script that is not listed says it, and lint:ratchets refuses a script that
 * drops the pragma or comes without it (`compareTsCheck`) unless a Ratchet-Exception trailer says
 * why, so no entry joins unseen.
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

/** The project of the dependency rules at a package's root (no pragma: checkJs checks them). */
const DEPENDENCY_RULES = "scripts/tsconfig.dependency-rules.json"

const saysTsCheck = (rel) => checkedByTsc(fs.readFileSync(path.join(repoRoot, rel), "utf8"))

describe("every script says // @ts-check, the ones not yet typed aside (pnpm typecheck:scripts)", () => {
  const scripts = repoScripts()

  it("finds the scripts and the dependency rules, the ones lint:ratchets holds to the pragma", () => {
    assert.ok(scripts.includes("scripts/check-ratchets.mjs"), scripts.join(", "))
    assert.ok(scripts.includes(".dependency-cruiser.cjs"), scripts.join(", "))
    const isScript = picomatch(REPO_SCRIPTS, { dot: true })
    const candidates = [
      ...fs.readdirSync(repoRoot),
      ...fs.readdirSync(path.join(repoRoot, "scripts")).map((name) => `scripts/${name}`),
      "scripts/nested/x.mjs",
      "apps/vscode/.dependency-cruiser.cjs",
    ]
    const differs = candidates.filter((rel) => isTypedScript(rel) !== isScript(rel))
    assert.deepEqual(differs, [], "check-ratchets.mjs's isTypedScript must name REPO_SCRIPTS")
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
    const { fileNames } = readProject("scripts/tsconfig.json")
    const read = new Set(fileNames)
    const unread = scripts.filter((rel) => !read.has(rel))
    assert.deepEqual(unread, [], "scripts/tsconfig.json's `include` misses them")
    const { scripts: root } = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    )
    assert.deepEqual(root["typecheck:scripts"].split(" && "), [
      "tsc -p scripts/tsconfig.json",
      `tsc -p ${DEPENDENCY_RULES}`,
    ])
    assert.ok(root.lint.split(" && ").includes("pnpm typecheck:scripts"), root.lint)
  })

  it("checks every package's own dependency rules whole, which can carry no pragma", () => {
    const rules = readWorkspace(repoRoot)
      .map(({ dir }) => `${dir}/.dependency-cruiser.cjs`)
      .filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
      .sort()
    assert.ok(rules.includes("apps/vscode/.dependency-cruiser.cjs"), rules.join(", "))
    const { fileNames, options } = readProject(DEPENDENCY_RULES)
    assert.deepEqual([...fileNames].sort(), rules, `${DEPENDENCY_RULES}'s \`include\``)
    assert.equal(options.checkJs, true)
  })
})

/** The project tsconfig of the scripts at `rel` names: its files (repo-relative) and options. */
function readProject(rel) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(repoRoot, rel),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      },
    },
  )
  assert.ok(parsed, rel)
  const fileNames = parsed.fileNames.map((file) => path.relative(repoRoot, file))
  return { fileNames, options: parsed.options }
}
