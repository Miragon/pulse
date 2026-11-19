/// <reference types="node" />
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { compile } from "tailwindcss"
import { themeCss } from "../theme/theme-css.test-support.js"

/** The CSS Tailwind writes for `classes` over the kit's theme, whitespace folded to one space. */
export async function compiled(classes: readonly string[]): Promise<string> {
  const tailwind = readFileSync(
    createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
    "utf8",
  )
  const css = await compile(
    `${tailwind}\n${themeCss.replace(/^@import .*;$/gm, "")}\n@tailwind utilities;`,
  )
  return css.build([...classes]).replace(/\s+/g, " ")
}

/** Every class of the elements under `root` (and `root` itself). */
export function classesUnder(root: Element): string[] {
  return [root, ...root.querySelectorAll("*")].flatMap((el) =>
    (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
  )
}

/** The rules inside every `@container bar (width < <width>)` block of `css`, joined. */
export function narrowRules(css: string, width: string): string {
  return css
    .split(`@container bar (width < ${width}) {`)
    .slice(1)
    .map((block) => block.split(/\}\s*\}/)[0] ?? "")
    .join(" ")
}
