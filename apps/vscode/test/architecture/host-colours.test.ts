import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { APP_ROOT } from "./support/files.js"

const WEBVIEW = join(APP_ROOT, "src/webview")
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
        (name) => `${relative(APP_ROOT, path)}: ${name}`,
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
})
