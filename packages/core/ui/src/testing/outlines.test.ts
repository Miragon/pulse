import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { FOCUS_RING, FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { outlineFindings, scanOutlines } from "./outlines.js"

const found = (source: string, file = "w.tsx") =>
  outlineFindings(source, file).map((f) => `${f.line}:${f.match}`)

describe("outlineFindings: no outline at rest under forced colours", () => {
  it("finds outline-hidden without a focus variant: bare, important, in JSX, cn() and templates", () => {
    const source = [
      "// outline-hidden in a comment is no finding",
      'export const a = <button className="rounded outline-hidden">x</button>',
      'export const b = cn("px-2", ok && "!outline-hidden")',
      "export const c = `ring-0 ${x} outline-hidden! border`",
      'export const d = { base: "outline-hidden" }',
    ].join("\n")
    expect(found(source)).toEqual([
      "2:outline-hidden",
      "3:!outline-hidden",
      "4:outline-hidden!",
      "5:outline-hidden",
    ])
  })

  it("finds it under a variant that is no focus state: a breakpoint, hover, a state, forced colours", () => {
    const source = [
      'export const a = "md:outline-hidden hover:outline-hidden"',
      'export const b = "data-[state=open]:outline-hidden aria-[current=page]:outline-hidden"',
      'export const c = "forced-colors:outline-hidden dark:md:outline-hidden [&>svg]:outline-hidden"',
    ].join("\n")
    expect(found(source)).toEqual([
      "1:md:outline-hidden",
      "1:hover:outline-hidden",
      "2:data-[state=open]:outline-hidden",
      "2:aria-[current=page]:outline-hidden",
      "3:forced-colors:outline-hidden",
      "3:dark:md:outline-hidden",
      "3:[&>svg]:outline-hidden",
    ])
  })

  it("finds it under a negated focus state, which applies exactly at rest", () => {
    const source = [
      'export const a = "not-focus:outline-hidden not-focus-visible:outline-hidden"',
      'export const b = "[&:not(:focus-visible)]:outline-hidden group-not-focus:outline-hidden"',
      'export const c = "not-focus-within:outline-hidden md:not-focus:outline-hidden"',
    ].join("\n")
    expect(found(source)).toEqual([
      "1:not-focus:outline-hidden",
      "1:not-focus-visible:outline-hidden",
      "2:[&:not(:focus-visible)]:outline-hidden",
      "2:group-not-focus:outline-hidden",
      "3:not-focus-within:outline-hidden",
      "3:md:not-focus:outline-hidden",
    ])
  })

  it("passes it under a focus state, and outline-none or another outline utility anywhere", () => {
    const source = [
      'export const a = "focus-visible:outline-hidden focus:outline-hidden focus-within:outline-hidden"',
      'export const b = "group-focus-visible:outline-hidden peer-focus/name:outline-hidden"',
      'export const f = "in-focus:outline-hidden has-focus-visible:outline-hidden [&:focus]:outline-hidden"',
      'export const c = "[&:focus-visible]:outline-hidden md:focus-visible:!outline-hidden"',
      'export const d = "outline-none focus-visible:outline-2 outline-offset-2 outline-hidden-x"',
      "export const e = <p>Draws no outline at rest</p>",
    ].join("\n")
    expect(found(source)).toEqual([])
  })

  it("passes the kit's own focus rings", () => {
    expect(
      found(`export const a = "${FOCUS_RING}"\nexport const b = "${FOCUS_RING_INSET}"`),
    ).toEqual([])
  })
})

describe("scanOutlines over a source tree", () => {
  const root = mkdtempSync(join(tmpdir(), "outlines-"))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("reports each finding with its file relative to the tree and its line; tests are skipped", () => {
    mkdirSync(join(root, "widgets"))
    writeFileSync(
      join(root, "widgets", "row.tsx"),
      [
        'export const ok = "focus-visible:outline-hidden"',
        'export const bad = "outline-hidden"',
      ].join("\n"),
    )
    writeFileSync(join(root, "widgets", "row.test.tsx"), 'export const t = "outline-hidden"')
    expect(scanOutlines(root)).toEqual([
      { file: "widgets/row.tsx", line: 2, match: "outline-hidden", text: "outline-hidden" },
    ])
  })
})
