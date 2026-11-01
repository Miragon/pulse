import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { scanTypeScale, typeScaleFindings } from "./type-scale.js"

const found = (source: string) =>
  typeScaleFindings(source, "x.tsx").map(({ rule, match }) => `${rule}:${match}`)

describe("typeScaleFindings", () => {
  it("passes the five steps of the scale", () => {
    expect(
      found(
        `const a = "text-title text-section text-body text-dense text-small md:text-dense"
         const b = \`text-small \${x}\``,
      ),
    ).toEqual([])
  })

  it("fails text below the 13 px floor", () => {
    expect(
      found(`const a = "text-xs sm:text-2xs text-[11px] text-[0.7rem] text-[length:10px]"`),
    ).toEqual([
      "below-floor:text-xs",
      "below-floor:sm:text-2xs",
      "below-floor:text-[11px]",
      "below-floor:text-[0.7rem]",
      "below-floor:text-[length:10px]",
    ])
  })

  it("fails Tailwind's own sizes and other arbitrary sizes as off the scale", () => {
    expect(
      found(`const a = "text-sm text-base md:text-lg text-xl text-2xl text-[15px] text-[1rem]"`),
    ).toEqual([
      "off-scale:text-sm",
      "off-scale:text-base",
      "off-scale:md:text-lg",
      "off-scale:text-xl",
      "off-scale:text-2xl",
      "off-scale:text-[15px]",
      "off-scale:text-[1rem]",
    ])
  })

  it("never mistakes a step or a colour for a size, and skips comments", () => {
    expect(
      found(`// text-xs in a comment
        const a = "text-small text-section text-muted-foreground text-smaller-thing text-sm-ish"`),
    ).toEqual([])
  })

  it("names the line of the literal", () => {
    expect(typeScaleFindings(`\n\nconst a = "text-xs"`, "x.tsx")[0]).toMatchObject({
      file: "x.tsx",
      line: 3,
      text: "text-xs",
    })
  })
})

describe("scanTypeScale", () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("scans a tree's sources (not its tests), optionally one rule only", () => {
    dir = mkdtempSync(join(tmpdir(), "type-scale-"))
    writeFileSync(join(dir, "a.tsx"), `export const a = "text-xs text-sm"`)
    writeFileSync(join(dir, "a.test.tsx"), `export const t = "text-xs"`)
    expect(scanTypeScale(dir).map((f) => `${f.file}:${f.match}`)).toEqual([
      "a.tsx:text-xs",
      "a.tsx:text-sm",
    ])
    expect(scanTypeScale(dir, { rules: ["below-floor"] }).map((f) => f.match)).toEqual(["text-xs"])
  })
})
