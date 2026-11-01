import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { iconSizeFindings, scanIconSizes } from "./icon-sizes.js"

describe("iconSizeFindings — icons at the CI sizes only", () => {
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
      { file: "probe.tsx", line: 1, size: 14 },
      { file: "probe.tsx", line: 2, size: 20 },
      { file: "probe.tsx", line: 8, size: 12 },
    ])
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
    expect(scanIconSizes(dir)).toEqual([{ file: "nested/a.tsx", line: 1, size: 14 }])
  })
})
