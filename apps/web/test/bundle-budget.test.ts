import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildWeb, type WebBuild } from "./web-build.js"

/**
 * The page's gzip ceilings (test/__golden__/bundle-budget.json): every first load of the web app
 * downloads its script and its stylesheet. Shrink-only (scripts/check-ratchets.mjs), and a file that
 * shrank more than 10 % below its ceiling must lower it.
 */

const BUDGET = JSON.parse(
  readFileSync(new URL("./__golden__/bundle-budget.json", import.meta.url), "utf8"),
) as Readonly<Record<string, number | string>>

const TIGHT = 0.9

const ceilings = Object.entries(BUDGET).filter(
  (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
)

let build: WebBuild

beforeAll(async () => {
  build = await buildWeb()
})

afterAll(() => build.remove())

/** The build's assets of one kind (`js`, `css`), their names hashed. */
const assetsOf = (extension: string) =>
  readdirSync(join(build.dir, "assets")).filter((name) => name.endsWith(`.${extension}`))

describe("the page's bundle", () => {
  it("has one script and one stylesheet, each with a ceiling", () => {
    expect(ceilings.map(([kind]) => kind)).toEqual(["js", "css"])
    for (const [kind] of ceilings) expect(assetsOf(kind), kind).toHaveLength(1)
  })

  it.each(ceilings)("its %s stays within %i bytes gzip", (kind, ceiling) => {
    const [file = ""] = assetsOf(kind)
    const gzip = gzipSync(readFileSync(join(build.dir, "assets", file))).length
    expect(
      gzip,
      `${file} is ${String(gzip)} bytes gzip, over its ceiling: shrink it, or raise the ceiling in test/__golden__/bundle-budget.json with a Ratchet-Exception trailer that says why`,
    ).toBeLessThanOrEqual(ceiling)
    expect(
      gzip,
      `${file} is ${String(gzip)} bytes gzip, well below its ceiling of ${String(ceiling)}: lower the ceiling to about ${String(Math.ceil((gzip * 1.02) / 100) * 100)}`,
    ).toBeGreaterThan(ceiling * TIGHT)
  })
})
