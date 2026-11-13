import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { DENSE_ICON_SIZE, iconSizeFindings, scanIconSizes } from "./icon-sizes.js"

const sizesOf = (source: string) =>
  iconSizeFindings(source, "probe.tsx").map(({ line, size, match }) => [line, size, match])

describe("iconSizeFindings: icons at the CI sizes only", () => {
  it("flags an off-size icon and spares the CI sizes, the default and string sizes", () => {
    const probe = [
      "const a = <Icon icon={TriangleAlert} size={14} dense />",
      "const b = <Icon icon={LayoutDashboard} size={20} />",
      "const c = <Icon icon={RefreshCw} size={16} />",
      "const d = <Workflow size={24} />",
      "const e = <Icon icon={X} />",
      'const f = <Button size="sm" />',
      "const g = <Icon icon={X} size={big ? 24 : 16} />",
      "const h = <CircleAlert size={12} />",
    ].join("\n")
    expect(iconSizeFindings(probe, "probe.tsx")).toEqual([
      { file: "probe.tsx", line: 1, size: 14, match: "size={14}" },
      { file: "probe.tsx", line: 2, size: 20, match: "size={20}" },
      { file: "probe.tsx", line: 8, size: 12, match: "size={12}" },
    ])
  })

  it("reads both branches of a conditional size", () => {
    const probe = [
      "const a = <Icon icon={X} size={dense ? 12 : 16} />",
      "const b = <Icon icon={X} size={(wide ? 24 : 20)} />",
      'const c = <Button size={isIcon ? "icon-sm" : "sm"} />',
    ].join("\n")
    expect(sizesOf(probe)).toEqual([
      [1, 12, "size={12}"],
      [2, 20, "size={20}"],
    ])
  })

  it("reads size classes on svg selectors anywhere in a file, in Tailwind's spacing steps, px and rem", () => {
    const probe = [
      'const badge = "inline-flex h-5 [&>svg]:pointer-events-none [&>svg]:size-3!"',
      "const xs = \"h-6 has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3\"",
      "const lead = { icon: cn('[&_svg]:size-5', tone) }",
      "const px = `gap-1 ${FOCUS_RING} [&_svg]:size-[14px]`",
      "const rem = '[&>svg]:size-[1.25rem] [&_.lucide]:!size-3'",
      "const v3 = 'group-hover:[&>svg]:!size-3.5'",
    ].join("\n")
    expect(sizesOf(probe)).toEqual([
      [1, 12, "[&>svg]:size-3!"],
      [2, 12, "[&_svg:not([class*='size-'])]:size-3"],
      [3, 20, "[&_svg]:size-5"],
      [4, 14, "[&_svg]:size-[14px]"],
      [5, 20, "[&>svg]:size-[1.25rem]"],
      [5, 12, "[&_.lucide]:!size-3"],
      [6, 14, "group-hover:[&>svg]:!size-3.5"],
    ])
  })

  it("spares svg selectors at the CI sizes and size classes that size no svg", () => {
    const probe = [
      "const chrome = \"[&_svg:not([class*='size-'])]:size-4 [&>svg]:size-6 [&_svg]:size-[16px]\"",
      'const button = "size-9 has-[>svg]:px-1.5 has-[>svg]:size-8"',
      'const dot = "size-1.5 rounded-full size-3"',
      'const path = "[&_svg_path]:size-3 [&_svg]:size-full [&_svg]:size-(--icon)"',
      'const word = "size-3 is a word in a sentence"',
    ].join("\n")
    expect(sizesOf(probe)).toEqual([])
  })

  it("reads size classes on Icon and on the Lucide components the file imports, not on other elements", () => {
    const probe = [
      'import { CircleAlert, X as Close } from "lucide-react"',
      'import { Avatar } from "./avatar"',
      'const a = <Icon icon={X} className="mt-0.5 size-5 shrink-0" />',
      'const b = <CircleAlert className={cn("size-3", TONE_ICON[tone])} />',
      "const c = <Close className={`size-[18px] ${extra}`} />",
      'const d = <Icon icon={X} className="size-4" />',
      'const e = <span className="size-3 rounded-full" />',
      'const f = <Avatar className="size-5" />',
      'const g = <Icon icon={X} className={open ? "size-6" : "sm:size-5"} />',
    ].join("\n")
    expect(sizesOf(probe)).toEqual([
      [3, 20, "size-5"],
      [4, 12, "size-3"],
      [5, 18, "size-[18px]"],
      [9, 20, "sm:size-5"],
    ])
  })

  it("reports the line of the class inside a multi-line template", () => {
    const probe = ["const v = `", "  h-6 px-2", "  [&_svg]:size-3", "`"].join("\n")
    expect(sizesOf(probe)).toEqual([[3, 12, "[&_svg]:size-3"]])
  })
})

describe("scanIconSizes", () => {
  const dir = mkdtempSync(join(tmpdir(), "icon-sizes-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("walks a tree with relative paths and skips tests", () => {
    mkdirSync(join(dir, "nested"))
    writeFileSync(join(dir, "nested", "a.tsx"), "const a = <Icon icon={X} size={14} />\n")
    writeFileSync(join(dir, "b.tsx"), "const b = <Icon icon={X} />\n")
    writeFileSync(join(dir, "c.test.tsx"), "const c = <Icon icon={X} size={10} />\n")
    expect(scanIconSizes(dir)).toEqual([
      { file: "nested/a.tsx", line: 1, size: 14, match: "size={14}" },
    ])
  })
})

describe("scanIconSizes: 12 px only where the dense deviation names the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "icon-sizes-dense-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("spares 12 px in a listed file, flags it elsewhere, flags any other size and an allowance nothing needs", () => {
    writeFileSync(
      join(dir, "badge.tsx"),
      ['const b = "[&>svg]:size-3!"', "const lead = <Icon icon={X} size={20} />"].join("\n"),
    )
    writeFileSync(join(dir, "card.tsx"), 'const c = "[&_svg]:size-3"\n')
    writeFileSync(join(dir, "chrome.tsx"), "const c = <Icon icon={X} size={16} />\n")
    const allowDense = {
      "badge.tsx": "a probe",
      "chrome.tsx": "a probe whose icons are 16 px",
      "gone.tsx": "a probe whose file is gone",
    }
    expect(scanIconSizes(dir, { allowDense })).toEqual([
      { file: "badge.tsx", line: 2, size: 20, match: "size={20}" },
      { file: "card.tsx", line: 1, size: DENSE_ICON_SIZE, match: "[&_svg]:size-3" },
      { file: "chrome.tsx", line: 0, size: DENSE_ICON_SIZE, match: "unused allowance" },
      { file: "gone.tsx", line: 0, size: DENSE_ICON_SIZE, match: "unused allowance" },
    ])
  })

  it("asks every allowance for its reason", () => {
    expect(() => scanIconSizes(dir, { allowDense: { "badge.tsx": " " } })).toThrow(
      "The allowance for badge.tsx needs a reason",
    )
  })
})
