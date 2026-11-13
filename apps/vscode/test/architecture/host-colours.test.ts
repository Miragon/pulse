import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { stylesheetColorFindings } from "@miragon/pulse-ui/testing"
import { describe, expect, test } from "vitest"
import { REPO_ROOT } from "./support/files.js"

const WEBVIEW = join(REPO_ROOT, "packages/core/runtime-view/src/webview")
const VENDORED = join(WEBVIEW, "theme")

function stylesheetsUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return path === VENDORED ? [] : stylesheetsUnder(path)
    }
    return entry.name.endsWith(".css") ? [path] : []
  })
}

function hostColoursIn(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--vscode-[\w-]*/g)].map(
    (match) => match[0],
  )
}

describe("the webview stylesheets", () => {
  test("take no colour from VS Code", () => {
    const stylesheets = stylesheetsUnder(WEBVIEW)
    expect(stylesheets.length).toBeGreaterThan(0)
    const found = stylesheets.flatMap((path) =>
      hostColoursIn(readFileSync(path, "utf8")).map(
        (name) => `${relative(REPO_ROOT, path)}: ${name}`,
      ),
    )
    expect(found).toEqual([])
  })

  test.each([
    [".probe { color: var(--vscode-foreground); }", ["--vscode-foreground"]],
    [".probe { color: var(--cd-x, var(--vscode-x)); }", ["--vscode-x"]],
    [".probe { color: var(--cd-ui-text); }", []],
  ])("are read for VS Code colours: %s", (css, expected) => {
    expect(hostColoursIn(css)).toEqual(expected)
  })

  test("take no raw colour either, only the Miragon tokens", () => {
    const found = stylesheetsUnder(WEBVIEW).flatMap((path) =>
      stylesheetColorFindings(readFileSync(path, "utf8"), relative(REPO_ROOT, path)),
    )
    expect(found).toEqual([])
  })

  test.each([
    [".probe { color: #1D1D1D; }", ["#1D1D1D"]],
    [".probe { border-color: rgb(0 0 0 / 20%); }", ["rgb("]],
    [".probe { background: color-mix(in srgb, var(--cd-ui-text) 8%, transparent); }", []],
  ])("are read for raw colours: %s", (css, expected) => {
    expect(stylesheetColorFindings(css, "probe.css").map(({ match }) => match)).toEqual(expected)
  })
})
