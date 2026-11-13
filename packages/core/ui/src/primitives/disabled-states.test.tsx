/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"
import { ListFooter } from "../components/ListFooter.js"
import { MENU_ITEM } from "../kit/menu-item.js"
import { NativeSelect } from "../kit/native-select.js"
import { FIELD_TEXT } from "../lib/typography.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { attribute, openingTags } from "../render-scan.js"
import { themeCss } from "../theme/theme-css.test-support.js"
import { Button, buttonVariants } from "./button.js"
import { Input } from "./input.js"
import { Switch } from "./switch.js"
import { Tabs, TabsList, TabsTrigger } from "./tabs.js"

/**
 * Disabled is opaque and neutral, never faded (modeler-tool-design §8 "Deaktiviert", §13 "nie
 * über opacity"): quiet text and icon, per variant the fill the guide names, no hover, the
 * not-allowed cursor. Opacity would turn blue into navy over a dark ground.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url))
const noop = (): void => {}
const classesOf = (tag: string | undefined) => (attribute(tag ?? "", "class") ?? "").split(/\s+/)

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "toolbar",
  "link",
] as const

/** The disabled control of each kit primitive, as its class list. */
function disabledControls(): Record<string, string[]> {
  const buttons = Object.fromEntries(
    BUTTON_VARIANTS.map((variant) => [
      `Button ${variant}`,
      classesOf(
        openingTags(
          renderToStaticMarkup(
            <Button variant={variant} disabled>
              Retry
            </Button>,
          ),
          "button",
        )[0],
      ),
    ]),
  )
  const tabs = renderToStaticMarkup(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Open</TabsTrigger>
        <TabsTrigger value="b" disabled>
          Closed
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  )
  const lineTabs = renderToStaticMarkup(
    <Tabs defaultValue="a">
      <TabsList variant="line">
        <TabsTrigger value="a">Open</TabsTrigger>
        <TabsTrigger value="b" disabled>
          Closed
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  )
  const footer = renderToStaticMarkup(
    <LocaleProvider locale="en">
      <ListFooter shown={8} total={42} hasMore onLoadMore={noop} loadingMore noun="tasks" />
    </LocaleProvider>,
  )
  return {
    ...buttons,
    Input: classesOf(openingTags(renderToStaticMarkup(<Input disabled />), "input")[0]),
    NativeSelect: classesOf(
      openingTags(renderToStaticMarkup(<NativeSelect disabled />), "select")[0],
    ),
    "TabsTrigger (disabled)": classesOf(openingTags(tabs, "button")[1]),
    "TabsTrigger line (disabled)": classesOf(openingTags(lineTabs, "button")[1]),
    MENU_ITEM: MENU_ITEM.split(/\s+/),
    Switch: classesOf(openingTags(renderToStaticMarkup(<Switch disabled />), "button")[0]),
    "ListFooter's Load more": classesOf(openingTags(footer, "button")[0]),
  }
}

interface CssRule {
  selector: string
  at: number
  properties: ReadonlySet<string>
}

/** Tailwind's default theme (its spacing, say), which a consumer's `@import "tailwindcss"` brings. */
const TAILWIND_THEME = readFileSync(
  createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
  "utf8",
)

/** What Tailwind writes for `classes` over its theme and the kit's (the kit's imports left out). */
async function stylesheet(classes: readonly string[]): Promise<string> {
  const kit = themeCss.replace(/^@import .*;$/gm, "")
  return (await compile(`${TAILWIND_THEME}\n${kit}\n@tailwind utilities;`)).build([...classes])
}

/** The rules of {@link stylesheet}, a nested `@supports` inlined into its rule. */
async function rulesFor(classes: readonly string[]): Promise<CssRule[]> {
  const flat = (await stylesheet(classes)).replace(/@supports[^{}]*\{([^{}]*)\}/g, "$1")
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    at: match.index,
    properties: new Set(
      match[2]
        .split(";")
        .map((declaration) => declaration.slice(0, declaration.indexOf(":")).trim())
        .filter(Boolean),
    ),
  }))
}

describe("disabled kit controls are opaque, never faded (CI §8)", () => {
  const controls = disabledControls()

  it.each(Object.entries(controls))(
    "%s: quiet text, the not-allowed cursor, no opacity",
    (name, classes) => {
      expect(classes.length).toBeGreaterThan(1)
      expect(classes).toContain("disabled:cursor-not-allowed")
      // Pointer events stay on, or the cursor would never show.
      expect(classes).not.toContain("disabled:pointer-events-none")
      expect(classes.filter((c) => /opacity/.test(c) && /disabled/.test(c))).toEqual([])
      // The switch shows it in its thumb (below), every other control in its text.
      if (name !== "Switch") expect(classes).toContain("disabled:text-muted-foreground")
    },
  )

  it("each Button variant takes the fill the guide names: hover fill with a line edge when filled, its own fill when secondary, transparent when ghost or toolbar", () => {
    const disabled = (variant: (typeof BUTTON_VARIANTS)[number]) =>
      buttonVariants({ variant })
        .split(/\s+/)
        .filter((c) => c.startsWith("disabled:"))
        .sort()
    for (const variant of ["default", "destructive"] as const) {
      expect(disabled(variant), variant).toEqual(
        [
          "disabled:bg-accent",
          "disabled:border-border",
          "disabled:cursor-not-allowed",
          "disabled:shadow-none",
          "disabled:text-muted-foreground",
          "disabled:translate-y-0",
        ].sort(),
      )
    }
    expect(disabled("outline")).toEqual([
      "disabled:bg-raised",
      "disabled:border-border",
      "disabled:cursor-not-allowed",
      "disabled:text-muted-foreground",
    ])
    expect(disabled("secondary")).toEqual([
      "disabled:bg-secondary",
      "disabled:border-border",
      "disabled:cursor-not-allowed",
      "disabled:text-muted-foreground",
    ])
    for (const variant of ["ghost", "toolbar"] as const) {
      expect(disabled(variant), variant).toEqual([
        "disabled:bg-transparent",
        "disabled:cursor-not-allowed",
        "disabled:text-muted-foreground",
      ])
    }
    expect(disabled("link")).toEqual([
      "disabled:cursor-not-allowed",
      "disabled:no-underline",
      "disabled:text-muted-foreground",
    ])
  })

  it("the switch keeps its state readable: the hover fill with a line edge in either state, the thumb quiet", () => {
    const html = renderToStaticMarkup(<Switch disabled defaultChecked />)
    const [track] = openingTags(html, "button")
    const [thumb] = openingTags(html, "span")
    expect(classesOf(track)).toEqual(
      expect.arrayContaining([
        "disabled:border-border",
        "disabled:data-[state=checked]:bg-accent",
        "disabled:data-[state=unchecked]:bg-accent",
      ]),
    )
    expect(attribute(thumb ?? "", "data-disabled")).toBe("")
    expect(classesOf(thumb)).toEqual(
      expect.arrayContaining(["data-disabled:bg-muted-foreground", "data-disabled:shadow-none"]),
    )
  })

  it.each(Object.entries(controls))(
    "%s shows no hover: a later :disabled rule sets every property a :hover rule sets",
    async (_, classes) => {
      const rules = await rulesFor(classes)
      const hovers = rules.filter((rule) => rule.selector.endsWith(":hover"))
      const disabled = rules.filter((rule) => rule.selector.includes(":disabled"))
      for (const hover of hovers) {
        for (const property of hover.properties) {
          expect(
            disabled.some((rule) => rule.at > hover.at && rule.properties.has(property)),
            `${hover.selector} sets ${property}`,
          ).toBe(true)
        }
      }
    },
  )

  it("the stylesheet check reads the hover and disabled rules it compares", async () => {
    const rules = await rulesFor(buttonVariants({ variant: "default" }).split(/\s+/))
    const hover = rules.find((rule) => rule.selector.includes("hover\\:bg-primary-hover"))
    const disabled = rules.find((rule) => rule.selector.includes("disabled\\:bg-accent"))
    expect(hover?.properties.has("background-color")).toBe(true)
    expect(disabled?.properties.has("background-color")).toBe(true)
    expect(disabled!.at).toBeGreaterThan(hover!.at)
  })
})

describe("no kit source fades a control", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return files(path)
      return /\.tsx?$/.test(entry) && !/\.test(-support)?\.tsx?$/.test(entry) ? [path] : []
    })

  it.each(["primitives", "kit", "components"])("src/%s has no disabled opacity", (dir) => {
    const faded = files(join(SRC, dir)).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/[\w:[\]=/-]*disabled[\w:[\]=/-]*:opacity-\d+/g)].map(
        (match) => `${path.slice(SRC.length)}: ${match[0]}`,
      ),
    )
    expect(faded).toEqual([])
  })
})

describe("fields take 13 px, 16 px on a coarse pointer (iOS zooms into smaller text)", () => {
  it("is the dense step with the body step under any-pointer: coarse", () => {
    expect(FIELD_TEXT).toBe("text-dense any-pointer-coarse:text-body")
  })

  it.each([
    ["Input", openingTags(renderToStaticMarkup(<Input />), "input")[0]],
    ["NativeSelect", openingTags(renderToStaticMarkup(<NativeSelect />), "select")[0]],
  ])("%s", (_, tag) => {
    expect(classesOf(tag)).toEqual(expect.arrayContaining(FIELD_TEXT.split(" ")))
    expect(classesOf(tag)).not.toContain("text-body")
  })

  it("compiles to the body step under the coarse pointer only", async () => {
    const css = (await stylesheet(FIELD_TEXT.split(" "))).replace(/\s+/g, " ")
    expect(css).toMatch(/(?:^|\} )\.text-dense \{ font-size: var\(--text-dense\);/)
    expect(css).toMatch(
      /@media \(any-pointer: coarse\) \{ \.any-pointer-coarse\\:text-body \{ font-size: var\(--text-body\);/,
    )
  })
})
