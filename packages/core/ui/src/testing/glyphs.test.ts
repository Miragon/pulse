import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { FORBIDDEN_GLYPHS, glyphFindings, scanGlyphs } from "./glyphs.js"

describe("glyphFindings — no Unicode glyphs or emoji as icons", () => {
  it("finds a glyph in JSX text, attributes, string and template literals", () => {
    const source = [
      "// a comment may name ✦ freely",
      "/* and so may ⚠ a block comment */",
      "export const a = <span aria-hidden>▦</span>",
      'export const b = <button title="Retry ↻">x</button>',
      'export const c = "⏱ slow"',
      "export const d = `${x} ›`",
      "export const e = `${x} ✓ ${y}`",
      "export const f = `✕ ${y}`",
    ].join("\n")
    expect(glyphFindings(source, "w.tsx").map((f) => [f.line, f.glyph])).toEqual([
      [3, "▦"],
      [4, "↻"],
      [5, "⏱"],
      [6, "›"],
      [7, "✓"],
      [8, "✕"],
    ])
  })

  it("finds emoji, not ordinary punctuation, arrows or dashes", () => {
    const source = [
      'export const notes = "🗒 Notes"',
      'export const ok = "1–2 → 3 · ≥ 4 … — x"',
      "export const versions = <p>{a} ↔ {b}</p>",
      'export const prose = "compare v1 ↔ v2"',
    ].join("\n")
    const findings = glyphFindings(source, "catalog.ts")
    expect(findings).toEqual([{ file: "catalog.ts", line: 1, glyph: "🗒", text: "🗒 Notes" }])
  })

  it("finds a lone symbol as an element's whole content: the glyph-as-icon signature", () => {
    const source = [
      "export const a = <span aria-hidden>→</span>",
      "export const b = <button onClick={remove}>×</button>",
      "export const c = <button>−</button>",
      "export const d = <span aria-hidden>‹</span>",
      'export const e = <span>{"⌄"}</span>',
      'export const f = <div className="x">',
      "  !",
      "</div>",
      'export const g = <b>{open ? "▲" : ("▼")}</b>',
      'export const h = <>{"+"}</>',
      "export const i = <span aria-hidden>↔</span>",
      "export const j = <span>{/* next */}→</span>",
    ].join("\n")
    expect(glyphFindings(source, "w.tsx").map((f) => [f.line, f.glyph])).toEqual([
      [1, "→"],
      [2, "×"],
      [3, "−"],
      [4, "‹"],
      [5, "⌄"],
      [7, "!"],
      [9, "▲"],
      [9, "▼"],
      [10, "+"],
      [11, "↔"],
      [12, "→"],
    ])
  })

  it("leaves symbols in running text, separators and placeholders alone", () => {
    const source = [
      "export const a = <p>{from} → {to}</p>",
      "export const b = <p>Started 576 → 88</p>",
      "export const c = <span aria-hidden>·</span>",
      "export const d = <td>—</td>",
      "export const e = <span>%</span>",
      "export const f = <span>(</span>",
      'export const g = "→"',
      'export const h = <span title="→">x</span>',
      'export const i = <b>{label ?? "—"}</b>',
      "export const j = <p><b>1</b>→</p>",
      'export const k = <b>{dir === "▲" ? up : down}</b>',
      'export const l = <b>{"▲" ? up : down}</b>',
    ].join("\n")
    expect(glyphFindings(source, "w.tsx")).toEqual([])
  })

  it("finds × anywhere: the multiplication sign drawn as a close or remove icon", () => {
    expect(glyphFindings('export const x = "× Entfernen"', "m.ts").map((f) => f.glyph)).toEqual([
      "×",
    ])
  })

  it("finds the AI sparkle as a Lucide import too (CI U4), named or deep", () => {
    const source = [
      'import { Sparkles, FileSearch } from "lucide-react"',
      'import { WandSparkles as Magic, SparkleIcon } from "lucide-react"',
      'import Wand from "lucide-react/icons/wand-sparkles"',
      'import { Sparkles as Ok } from "./not-lucide"',
      'import * as Lucide from "lucide-react"',
      'import "lucide-react"',
    ].join("\n")
    expect(glyphFindings(source, "w.tsx").map((f) => [f.line, f.glyph])).toEqual([
      [1, "Sparkles"],
      [2, "WandSparkles"],
      [2, "SparkleIcon"],
      [3, "wand-sparkles"],
    ])
  })

  it("covers exactly the glyphs the cockpit used as icons", () => {
    expect(FORBIDDEN_GLYPHS).toEqual(
      expect.arrayContaining([
        "✦",
        "⊡",
        "▦",
        "↗",
        "›",
        "⚠",
        "⚙",
        "⏱",
        "⤧",
        "▶",
        "✓",
        "✕",
        "▤",
        "⊞",
        "↻",
      ]),
    )
    for (const glyph of FORBIDDEN_GLYPHS) {
      expect(glyphFindings(`export const g = "${glyph}"`, "g.ts")).toHaveLength(1)
    }
  })
})

describe("scanGlyphs — a source tree", () => {
  const root = mkdtempSync(join(tmpdir(), "glyphs-"))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("scans .ts/.tsx sources and skips tests, declarations and build output", () => {
    mkdirSync(join(root, "widgets"))
    mkdirSync(join(root, "node_modules"))
    mkdirSync(join(root, "dist"))
    writeFileSync(join(root, "widgets", "a.tsx"), "export const A = () => <b>⚙</b>\n")
    writeFileSync(join(root, "messages.ts"), 'export const m = { k: "▶ Start" }\n')
    writeFileSync(join(root, "widgets", "a.test.tsx"), 'const t = "⚙"\n')
    writeFileSync(join(root, "types.d.ts"), 'declare const t: "⚙"\n')
    writeFileSync(join(root, "node_modules", "x.ts"), 'const t = "⚙"\n')
    writeFileSync(join(root, "dist", "x.ts"), 'const t = "⚙"\n')
    writeFileSync(join(root, "readme.md"), "⚙\n")
    expect(
      scanGlyphs(root)
        .map((f) => `${f.file}:${f.line}:${f.glyph}`)
        .sort(),
    ).toEqual(["messages.ts:1:▶", "widgets/a.tsx:1:⚙"])
  })
})
