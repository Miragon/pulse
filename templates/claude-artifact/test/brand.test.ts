import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { BARE_PAUSE_RULE_EN, glossaryFindings, PRODUCT_GLOSSARY } from "@miragon/pulse-ui/glossary"
import {
  catalogTextFindings,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
} from "@miragon/pulse-ui/testing"
import { describe, expect, it } from "vitest"
import { ERROR_CATALOGS } from "../src/engine/errors.ts"
import { DE, EN } from "../src/messages.ts"
import { STYLESHEET } from "../vite.config.ts"

/**
 * pulse-ui's brand gates over the page (ESLint's gates do not reach a template, so these hold it):
 * colours by role only, Lucide icons at 16 or 24 px, the type scale, no hidden outline at rest,
 * the voice rules and the product's words in English and German, and no stylesheet of the page's
 * own: pulse-ui's holds every class the page's elements name. The theme's contrast is pulse-ui's
 * to hold (its tone-contrast test), since a page cannot change it.
 */

const SRC = join(import.meta.dirname, "../src")
const SCAN = { timeout: 30_000 }
const KIT_CSS = readFileSync(STYLESHEET, "utf8")

/** Every source file of the page, by its path under src/. */
function sources(dir = SRC, prefix = ""): { file: string; text: string }[] {
  return readdirSync(join(dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [{ file: `${prefix}${entry.name}`, text: readFileSync(join(dir, entry.name), "utf8") }],
  )
}

/**
 * The classes a source names on its elements: the string literals of a `className` (or a
 * column's `cellClassName`), an attribute's value or every literal in its expression (`cn(…)`, a
 * condition). The page keeps its classes there, so this finds them all.
 */
function classesOf(text: string): string[] {
  const classes: string[] = []
  const attribute = /[cC]lassName(?:=|:\s*)/g
  for (let match = attribute.exec(text); match !== null; match = attribute.exec(text)) {
    let at = match.index + match[0].length
    let value: string
    if (text[at] === '"') {
      const end = text.indexOf('"', at + 1)
      value = `"${text.slice(at + 1, end)}"`
    } else if (text[at] === "{") {
      let depth = 0
      const start = at
      for (; at < text.length; at++) {
        if (text[at] === "{") depth++
        if (text[at] === "}" && --depth === 0) break
      }
      value = text.slice(start, at)
    } else {
      continue
    }
    for (const literal of value.matchAll(/"([^"]*)"/g)) {
      classes.push(...literal[1].split(/\s+/).filter(Boolean))
    }
  }
  return classes
}

/** A class as Tailwind writes its selector: every character past letters, digits, - and _ escaped. */
const selectorOf = (name: string) => `.${name.replace(/[^\w-]/g, (c) => `\\${c}`)}`

/** Whether `css` holds a rule for the class `name`: its selector, not a longer class's prefix. */
function holdsClass(css: string, name: string): boolean {
  const selector = selectorOf(name)
  for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
    if (!/[\w-]/.test(css[at + selector.length] ?? "")) return true
  }
  return false
}

describe("the page's sources", () => {
  it("colour through role names only", SCAN, () => {
    expect(scanColors(SRC)).toEqual([])
  })

  it("draw icons with Lucide, never glyphs or emoji", SCAN, () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })

  it("draw icons at 16 or 24 px", SCAN, () => {
    expect(scanIconSizes(SRC)).toEqual([])
  })

  it("set text on the type scale and its three weights", SCAN, () => {
    expect(scanTypeScale(SRC).map((f) => `${f.file}:${String(f.line)} ${f.match}`)).toEqual([])
  })

  it("hide no outline at rest", SCAN, () => {
    expect(scanOutlines(SRC)).toEqual([])
  })

  it("keep no stylesheet of their own: the page's one stylesheet is pulse-ui's", () => {
    expect(sources().filter(({ file }) => file.endsWith(".css"))).toEqual([])
  })

  it("name only classes pulse-ui.css holds, the kit's and its documented layout utilities", () => {
    const missing = sources().flatMap(({ file, text }) =>
      classesOf(text)
        .filter((name) => !holdsClass(KIT_CSS, name))
        .map((name) => `${file}: ${name}`),
    )
    expect(missing).toEqual([])
  })

  it("find a class the stylesheet lacks, so the check above can fail", () => {
    const text = 'className="flex gap-4" className={cn("h-80", ok && "lg:col-span-5")}'
    expect(classesOf(text)).toEqual(["flex", "gap-4", "h-80", "lg:col-span-5"])
    expect(holdsClass(KIT_CSS, "lg:col-span-5")).toBe(true)
    expect(holdsClass(KIT_CSS, "h-80")).toBe(false)
    expect(holdsClass(KIT_CSS, "gap-1")).toBe(true)
    expect(holdsClass(".gap-10{}", "gap-1")).toBe(false)
  })
})

describe("the page's words", () => {
  it("hold the same keys in English and German", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort())
  })

  it.each([
    ["en", EN, ERROR_CATALOGS.en],
    ["de", DE, ERROR_CATALOGS.de],
  ] as const)("follow the voice rules and the glossary (%s)", (language, page, errors) => {
    const rules =
      language === "en" ? [...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN] : PRODUCT_GLOSSARY.de
    for (const catalog of [page, errors]) {
      expect(catalogTextFindings(catalog, { language })).toEqual([])
      expect(glossaryFindings(catalog, rules)).toEqual([])
    }
  })
})
