import { readdirSync } from "node:fs"
import {
  glossaryFindings,
  PRODUCT_GLOSSARY,
  scanColors,
  scanGlyphs,
  sourceTexts,
} from "@miragon/pulse-ui/testing"
import { describe, expect, test } from "vitest"
import { PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, PLUGIN_SOURCES } from "./support/files.js"

function wordFindings(root: string): string[] {
  return glossaryFindings(sourceTexts(root), PRODUCT_GLOSSARY.en).map(
    (finding) => `${finding.key}: "${finding.text}", write ${finding.use}`,
  )
}

describe("the plugin's own texts", PARSING_SOURCES_ON_A_BUSY_CI_RUNNER, () => {
  test("are read in every part of the plugin: the worker, the panel and the editor frames", () => {
    const parts = readdirSync(PLUGIN_SOURCES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(parts).toEqual(["editor", "panel", "worker"])
    expect(Object.keys(sourceTexts(PLUGIN_SOURCES))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^panel\/engines\.tsx:/),
        expect.stringMatching(/^worker\/engine-registry\.ts:/),
      ]),
    )
  })

  test("use the product's words, never their synonyms", () => {
    expect(wordFindings(PLUGIN_SOURCES)).toEqual([])
  })

  test("draw no glyph, emoji or sparkle as an icon", () => {
    expect(scanGlyphs(PLUGIN_SOURCES)).toEqual([])
  })

  test("name no raw colour", () => {
    expect(scanColors(PLUGIN_SOURCES)).toEqual([])
  })
})
