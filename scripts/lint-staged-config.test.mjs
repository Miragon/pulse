// @ts-check
import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import config, { eslintRuns } from "../lint-staged.config.mjs"

/**
 * The pre-commit hook lints a staged file of a package with a baseline of budget violations
 * (eslint-suppressions.json, #688) from that package's folder, where ESLint reads the baseline's
 * paths, and every other file from the root; prettier writes every staged file as before.
 */
describe("lint-staged.config.mjs", () => {
  const root = "/repo"
  const at = (rel) => `${root}/${rel}`

  it("lints each baselined package from its folder and the rest from the root", () => {
    const runs = eslintRuns(
      [
        at("packages/core/ui/src/a.tsx"),
        at("packages/core/ui/test/b c.test.ts"),
        at("apps/web/src/c.ts"),
        at("apps/cli/src/d.ts"),
        at("packages/core/uix/src/e.ts"),
      ],
      root,
      path.posix,
    )
    assert.deepEqual(runs, [
      'pnpm --dir packages/core/ui exec eslint --fix "src/a.tsx" "test/b c.test.ts"',
      'pnpm --dir apps/web exec eslint --fix "src/c.ts"',
      `eslint --fix "${at("apps/cli/src/d.ts")}" "${at("packages/core/uix/src/e.ts")}"`,
    ])
  })

  it("finds the package on Windows, whose cwd has backslashes and whose paths have slashes", () => {
    const runs = eslintRuns(["C:/repo/packages/core/ui/src/a.tsx"], "C:\\repo", path.win32)
    assert.deepEqual(runs, ['pnpm --dir packages/core/ui exec eslint --fix "src/a.tsx"'])
  })

  it("runs no eslint for no file, and prettier over every staged script and data file", () => {
    assert.deepEqual(eslintRuns([], root, path.posix), [])
    const tasks = config["*.{ts,tsx}"]([at("apps/cli/src/d.ts")])
    assert.equal(tasks.at(-1), `prettier --write "${at("apps/cli/src/d.ts")}"`)
    assert.equal(config["*.{json,md,yml,yaml,css}"], "prettier --write")
  })
})
