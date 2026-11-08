import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { glossaryFindings, PRODUCT_GLOSSARY } from "./glossary.js"
import { sourceTexts } from "./source-texts.js"

describe("sourceTexts: the words of a source tree as a catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "source-texts-"))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  mkdirSync(join(root, "screens"))
  mkdirSync(join(root, "node_modules"))
  writeFileSync(
    join(root, "screens", "list.tsx"),
    [
      'import { label } from "./paused-instances.js"',
      'type Status = "paused instances"',
      'export const scope = { label: "With incidents", hint: "Live updates are paused" }',
      "export const note = (n: number) => `Instance ${String(n)} paused`",
      "export const List = () => (",
      "  <p title='Read now'>",
      "    Pause this",
      "    process",
      "  </p>",
      ")",
    ].join("\n"),
  )
  writeFileSync(join(root, "screens", "list.test.tsx"), 'const t = "Paused instances"\n')
  writeFileSync(join(root, "node_modules", "x.ts"), 'const t = "Paused instances"\n')

  it("reads string literals, whole templates and JSX text, keyed by file, line and column", () => {
    expect(sourceTexts(root)).toEqual({
      "screens/list.tsx:3:31": "With incidents",
      "screens/list.tsx:3:55": "Live updates are paused",
      "screens/list.tsx:4:36": "Instance {value} paused",
      "screens/list.tsx:6:12": "Read now",
      "screens/list.tsx:7:5": "Pause this process",
    })
  })

  it("feeds the glossary like a catalog", () => {
    expect(glossaryFindings(sourceTexts(root), PRODUCT_GLOSSARY.en)).toEqual([
      { key: "screens/list.tsx:4:36", text: "Instance  paused", use: "suspend, suspended" },
      { key: "screens/list.tsx:7:5", text: "Pause this process", use: "suspend, suspended" },
      { key: "screens/list.tsx:3:31", text: "With incidents", use: "With incident" },
    ])
  })
})
