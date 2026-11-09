import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CI_ICON_SIZES, scanColors, scanGlyphs, scanIconSizes } from "@miragon/pulse-ui/testing"
import { afterAll, describe, expect, test } from "vitest"
import { APP_ROOT, REPO_ROOT } from "./support/files.js"
import { ENGINE_CONTRACT_SOURCES, WORDED_LAYERS } from "./support/layers.js"

const SOURCES = join(APP_ROOT, "src")
const WEBVIEW = join(SOURCES, "webview")
const DENSE_ICON_SIZE = 12
const RENDERER_PAINT = "diagram/canvas-roles.ts"

const DENSE_ICONS_ALLOWED: Readonly<Record<string, string>> = {
  "components/count-badge.tsx": "the incident icon inside a 20 px count badge on the diagram",
  "diagram/code-button.tsx": "the code button, a 20 px overlay on a shape",
  "diagram/move-badge.tsx": "the move badge, a 20 px overlay on a shape",
  "diagram/move-entry.tsx": "a move entry, a 20 px overlay on a shape",
  "screens/called-instance-link.tsx": "an inline link inside a line of dense text",
  "screens/instance-header.tsx": "the caller link inside the header's dense meta line",
  "screens/mapping-table.tsx": "a warning inside a dense table cell",
  "screens/move-panel.tsx": "a warning inside a dense list line",
  "screens/variables-tab.tsx": "the shadow warning beside a variable's name in a dense table cell",
}

const RAW_COLOURS_ALLOWED = {
  [RENDERER_PAINT]:
    "bpmn-js paints with literal colours: the renderer's light paper and ink are constants that CanvasRoles maps to the vendored cd-canvas role classes, and test/webview/canvas-tokens.test.ts pins them to cd-tokens.generated.json",
}

function iconSizeFindings(root: string, allowed: Readonly<Record<string, string>>): string[] {
  const findings = scanIconSizes(root)
  const misplaced = findings
    .filter(({ file, size }) => size !== DENSE_ICON_SIZE || !(file in allowed))
    .map(({ file, line, size }) => `${file}:${String(line)}: ${String(size)} px`)
  const unused = Object.keys(allowed)
    .filter((file) => !findings.some((finding) => finding.file === file))
    .map((file) => `${file}: unused allowance`)
  return [...misplaced, ...unused]
}

function colourFindings(root: string) {
  return scanColors(root, { allow: RAW_COLOURS_ALLOWED })
}

describe("the extension follows pulse-ui's brand gates", () => {
  test.each(WORDED_LAYERS)(
    "its texts in %s draw no glyph, emoji or sparkle as an icon",
    (layer) => {
      expect(scanGlyphs(join(SOURCES, layer))).toEqual([])
    },
  )

  test("the texts of the engine contract the extension re-exports draw no glyph either", () => {
    expect(scanGlyphs(join(REPO_ROOT, ENGINE_CONTRACT_SOURCES))).toEqual([])
  })

  test(`the webview draws icons at the CI sizes, ${CI_ICON_SIZES.join(" and ")} px, or at ${DENSE_ICON_SIZE} px where the named deviation lists it, beside dense text and on the diagram's 20 px overlays`, () => {
    expect(iconSizeFindings(WEBVIEW, DENSE_ICONS_ALLOWED)).toEqual([])
  })

  test(`the webview still draws the ${DENSE_ICON_SIZE} px deviation, so the docs that name it stay true`, () => {
    expect(scanIconSizes(WEBVIEW).map(({ size }) => size)).toContain(DENSE_ICON_SIZE)
  })

  test("the webview colours through the vendored tokens, the renderer's paint constants aside", () => {
    expect(colourFindings(WEBVIEW)).toEqual([])
  })
})

describe("the brand gates over the webview", () => {
  const root = mkdtempSync(join(tmpdir(), "brand-gates-"))
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("flag a third icon size, a raw colour, a glyph icon and an allowance nothing needs", () => {
    mkdirSync(join(root, "screens"))
    writeFileSync(
      join(root, "screens", "probe.tsx"),
      [
        'export const Dense = () => <Icon of="" size={12} />',
        'export const Chrome = () => <Icon of="" size={16} />',
        'export const Odd = () => <Icon of="" size={14} />',
        'export const ink = "#1D1D1D"',
        "export const Done = () => <span>✓</span>",
      ].join("\n"),
    )
    writeFileSync(
      join(root, "screens", "chrome.tsx"),
      'export const B = () => <Icon of="" size={12} />',
    )
    const allowed = { "screens/probe.tsx": "a probe", "screens/gone.tsx": "a probe" }
    expect(iconSizeFindings(root, allowed)).toEqual([
      "screens/chrome.tsx:1: 12 px",
      "screens/probe.tsx:3: 14 px",
      "screens/gone.tsx: unused allowance",
    ])
    expect(colourFindings(root)).toEqual([
      { file: "screens/probe.tsx", line: 4, match: "#1D1D1D", text: "#1D1D1D" },
      {
        file: RENDERER_PAINT,
        line: 0,
        match: "unused allowance",
        text: RAW_COLOURS_ALLOWED[RENDERER_PAINT],
      },
    ])
    expect(scanGlyphs(root)).toEqual([
      expect.objectContaining({ file: "screens/probe.tsx", line: 5, glyph: "✓" }),
    ])
  })
})
