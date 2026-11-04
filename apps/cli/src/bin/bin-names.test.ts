/**
 * The npm package installs the program under two names: `pulse`, the command every text names
 * (CLI_NAME), and its second name `pulse-cli`, its name up to 0.25, so scripts and agents that call
 * it keep working. The second name is load-bearing for npx too: `npx @miragon/pulse-cli` runs the
 * bin named like the package without its scope, and finds nothing to run among two bins without
 * it. Both names are one program, the bundle of this directory's entry; test/integration/pack.it
 * installs the packed tarball and runs both.
 */

import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PACKAGE, SECOND_NAME } from "../../test/support/package-bins.js"
import { CLI_NAME } from "../util.js"

const ENTRY = "dist/pulse-cli.js"

describe("the bin names of the package", () => {
  it("are pulse and the unscoped package name, the bin npx runs", () => {
    expect(PACKAGE.name).toBe("@miragon/pulse-cli")
    expect(CLI_NAME).toBe("pulse")
    expect(SECOND_NAME).toBe("pulse-cli")
    expect(Object.keys(PACKAGE.bin).sort()).toEqual([CLI_NAME, SECOND_NAME])
  })

  it("point at the same entry, the bundle of src/bin/pulse-cli.ts", () => {
    expect(new Set(Object.values(PACKAGE.bin))).toEqual(new Set([ENTRY]))
    expect(PACKAGE.bin[CLI_NAME]).toBe(PACKAGE.bin[SECOND_NAME])
    expect(PACKAGE.files).toContain("dist")
    expect(existsSync(new URL("pulse-cli.ts", import.meta.url))).toBe(true)
  })
})
