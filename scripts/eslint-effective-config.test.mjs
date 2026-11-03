import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import {
  effectiveLooseningFindings,
  loosenings,
  sampleFromGlob,
} from "./eslint-effective-config.mjs"

/**
 * The effective-config half of the ESLint ratchet: whatever SHAPE a config
 * change takes (a const, a spread, an override block, a moved ignore), what
 * counts is the setting ESLint applies to a file. Each case evaluates a base
 * and a new config with ESLint itself.
 */

const GATE = ["error", { selector: "CallExpression[callee.property.name='tool']", message: "x" }]
const SECOND = ["error", { selector: "Literal[value='tool']", message: "y" }]

// The base: typed files, global budgets, a registrar-style gate with one exemption.
const BASE = `export default [
  { ignores: ["**/dist/**"] },
  { files: ["**/*.ts"] },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: { complexity: ["error", 15], "max-lines": ["error", { max: 400, skipBlankLines: true }] },
  },
  {
    files: ["packages/c/src/**/*.ts"],
    ignores: ["packages/c/src/widget-tools/**"],
    rules: { "no-restricted-syntax": ${JSON.stringify([...GATE, SECOND[1]])} },
  },
]`

const FILES = [
  "packages/c/src/tools/a.ts",
  "packages/c/src/tools/b.ts",
  "packages/c/src/tools/c.ts",
  "packages/c/src/widget-tools/w.ts",
  "packages/d/src/big.ts",
]

describe("effectiveLooseningFindings", () => {
  let dir
  let n = 0
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "eslint-effective-"))
    writeFileSync(path.join(dir, "base.mjs"), BASE)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  /** Findings of a new config (appended blocks / a full replacement) against BASE. */
  async function findings({ append = "", replace } = {}) {
    const text = replace ?? BASE.replace(/\]$/, `${append}\n]`)
    const file = path.join(dir, `new-${(n += 1)}.mjs`)
    writeFileSync(file, text)
    return effectiveLooseningFindings({
      cwd: dir,
      baseConfigFile: path.join(dir, "base.mjs"),
      newConfigFile: file,
      files: FILES,
      label: "eslint.config.mjs",
    })
  }

  /** The violation messages of those findings, one per reason. */
  const compare = async (change) => (await findings(change)).map(({ message }) => message)

  it("sees a budget switched off through a const, whatever the shape", async () => {
    const violations = await compare({
      replace: `const relaxed = { complexity: "off", "max-lines": "off" }\n${BASE.replace(/\]$/, `{ files: ["packages/d/src/big.ts"], rules: { ...relaxed } },\n]`)}`,
    })
    assert.equal(violations.length, 2)
    assert.match(
      violations.join("\n"),
      /complexity is no longer an error for 1 file\(s\): packages\/d\/src\/big\.ts/,
    )
    assert.match(violations.join("\n"), /max-lines is no longer an error/)
  })

  it("sees new debt in a raised budget and a relaxed skip option", async () => {
    const violations = await compare({
      append: `{ files: ["packages/d/src/big.ts"], rules: { complexity: ["error", 40], "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }] } },`,
    })
    assert.match(violations.join("\n"), /complexity 15 -> 40/)
    assert.match(violations.join("\n"), /max-lines now sets skipComments/)
  })

  it("sees an exemption copied into the GLOBAL ignores", async () => {
    const violations = await compare({
      replace: BASE.replace('"**/dist/**"', '"**/dist/**", "packages/c/src/tools/**"'),
    })
    assert.equal(violations.length, 1)
    assert.match(
      violations[0],
      /no longer linted at all .* for 3 file\(s\): packages\/c\/src\/tools\/a\.ts/,
    )
  })

  it("probes a sample path for a glob that names no existing file yet", async () => {
    const violations = await compare({
      replace: BASE.replace('"**/dist/**"', '"**/dist/**", "packages/c/src/tools/later.ts"'),
    })
    assert.match(
      violations.join("\n"),
      /no longer linted at all .* for 1 file\(s\): packages\/c\/src\/tools\/later\.ts/,
    )
  })

  it("sees a per-file override that REPLACES the gate's selectors", async () => {
    const found = await findings({
      append: `{ files: ["packages/c/src/tools/b.ts"], rules: { "no-restricted-syntax": ["error", "Foo", "Bar", "Baz"] } },`,
    })
    assert.equal(found.length, 1)
    assert.match(
      found[0].message,
      /drops 2 selector\(s\) other files keep.*packages\/c\/src\/tools\/b\.ts/,
    )
    assert.deepEqual(found[0].files, ["packages/c/src/tools/b.ts"])
    // The reason names one lost selector as an example; `lost` names every one,
    // so check-ratchets can match each to the commit that dropped it.
    assert.deepEqual(found[0].lost, {
      "packages/c/src/tools/b.ts": [GATE[1].selector, SECOND[1].selector].sort(),
    })
  })

  it("names the files of each reason, and no lost selectors for a severity change", async () => {
    const found = await findings({
      append: `{ files: ["packages/c/src/tools/a.ts", "packages/d/src/big.ts"], rules: { complexity: "off", "no-restricted-syntax": "off" } },`,
    })
    const byReason = Object.fromEntries(
      found.map(({ reason, files, lost }) => [reason, { files, lost }]),
    )
    assert.deepEqual(byReason["complexity is no longer an error"], {
      files: ["packages/c/src/tools/a.ts", "packages/d/src/big.ts"],
      lost: {},
    })
    assert.deepEqual(byReason["no-restricted-syntax is no longer an error"], {
      files: ["packages/c/src/tools/a.ts"],
      lost: {},
    })
  })

  it("lets a gate be rewritten for every file only without shrinking it", async () => {
    const rewritten = (selectors) =>
      compare({
        replace: BASE.replace(
          JSON.stringify([...GATE, SECOND[1]]),
          JSON.stringify(["error", ...selectors]),
        ),
      })
    assert.deepEqual(await rewritten(["MemberExpression[property.name='tool']", "A", "B"]), [])
    assert.match(
      (await rewritten(["MemberExpression[property.name='tool']"])).join("\n"),
      /shrank from 2 to 1 selector/,
    )
  })

  it("sees a carve-out hidden inside a gate rewritten for every file", async () => {
    const rewrittenWithOverride = BASE.replace(
      JSON.stringify([...GATE, SECOND[1]]),
      JSON.stringify(["error", "MemberExpression[property.name='tool']", "A"]),
    ).replace(
      /\]$/,
      `{ files: ["packages/c/src/tools/b.ts"], rules: { "no-restricted-syntax": ["error", "Foo", "Bar"] } },\n]`,
    )
    const violations = await compare({ replace: rewrittenWithOverride })
    assert.equal(violations.length, 1)
    assert.match(
      violations[0],
      /rewritten differently from the other files that shared its gate .* for 1 file\(s\): packages\/c\/src\/tools\/b\.ts/,
    )
  })

  it("accepts tightening: lower budgets, a dropped exemption, more selectors", async () => {
    const tighter = BASE.replace('["error", 15]', '["error", 12]')
      .replace('"packages/c/src/widget-tools/**"', "")
      .replace(JSON.stringify([...GATE, SECOND[1]]), JSON.stringify([...GATE, SECOND[1], "Extra"]))
    assert.deepEqual(await compare({ replace: tighter }), [])
  })
})

describe("loosenings (pure)", () => {
  const cfg = (rules) => ({ rules })

  it("ignores rules that were not errors on the base", () => {
    assert.deepEqual(loosenings(cfg({ complexity: [1, 10] }), cfg({ complexity: [0] })), [])
    assert.deepEqual(loosenings(undefined, undefined), [])
  })

  it("uses ESLint's defaults when the options are omitted", () => {
    assert.deepEqual(loosenings(cfg({ complexity: [2] }), cfg({ complexity: [2, 20] })), [])
    assert.deepEqual(loosenings(cfg({ complexity: [2] }), cfg({ complexity: [2, 21] })), [
      "complexity 20 -> 21",
    ])
    assert.deepEqual(loosenings(cfg({ "max-lines": [2, 300] }), cfg({ "max-lines": [2] })), [])
  })
})

describe("sampleFromGlob", () => {
  it("turns a files/ignores glob into one concrete path under apps/ or packages/", () => {
    assert.equal(sampleFromGlob("packages/c/src/tools/raw.ts"), "packages/c/src/tools/raw.ts")
    assert.equal(
      sampleFromGlob("packages/connectors/*/*/src/**/*.{ts,tsx}"),
      "packages/connectors/__probe__/__probe__/src/__probe__.ts",
    )
    assert.equal(
      sampleFromGlob("packages/c/src/widget-tools/**"),
      "packages/c/src/widget-tools/__probe__.ts",
    )
    assert.equal(sampleFromGlob("**/generated/**"), "packages/__probe__/generated/__probe__.ts")
    assert.equal(sampleFromGlob("!packages/c/src/x.ts"), null)
    assert.equal(sampleFromGlob("docs/.vitepress/config.ts"), null)
    assert.equal(sampleFromGlob("packages/[ab]/src/x.ts"), null)
  })
})
