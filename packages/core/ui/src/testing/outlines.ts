import { readFileSync } from "node:fs"
import {
  lineOf,
  literalText,
  parseSource,
  relativePath,
  sourceFiles,
  walkNodes,
} from "./source-scan.js"

/**
 * No permanent outline. Tailwind's `outline-hidden` hides the outline with a transparent 2 px one,
 * which forced colours (a Windows contrast theme) paint in a system colour: a class list that
 * applies it outside a focus state draws a 2 px frame around the control at rest under forced
 * colours, and focus then adds nothing visible. It belongs under a focus variant
 * (`focus-visible:outline-hidden`, as the kit's `FOCUS_RING` writes it), never a negated one
 * (`not-focus-visible:`), which applies at rest; `outline-none` removes the outline in every mode
 * and is no finding.
 */
export interface OutlineFinding {
  file: string
  line: number
  /** The class that draws the outline at rest (`outline-hidden`, `md:outline-hidden`). */
  match: string
  text: string
}

/** The variants of a class and its utility: `[&:hover]:md:!x` → `["[&:hover]", "md"]`, `"!x"`. */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < token.length; at++) {
    const char = token[at]
    if (char === "[" || char === "(") depth++
    else if ((char === "]" || char === ")") && depth > 0) depth--
    else if (char === ":" && depth === 0) {
      parts.push(token.slice(start, at))
      start = at + 1
    }
  }
  return { variants: parts, utility: token.slice(start) }
}

/**
 * A focus state: `focus`, `focus-visible`, `focus-within`, a group's, a peer's, an ancestor's
 * (`in-`) or a descendant's (`has-`), named or not (`peer-focus/name`), or an arbitrary variant
 * on the element's own focus (`[&:focus-visible]`). A negated one (`not-focus`,
 * `[&:not(:focus-visible)]`) applies exactly at rest, so it is no focus state.
 */
const FOCUS_VARIANT =
  /^(?:(?:group|peer|in|has)-)?focus(?:-visible|-within)?(?:\/[\w-]+)?$|^\[&:focus/

/** `outline-hidden`, important or not (`!outline-hidden`, `outline-hidden!`). */
const OUTLINE_HIDDEN = /^!?outline-hidden!?$/

function restingOutlines(text: string): string[] {
  return text.split(/\s+/).filter((token) => {
    const { variants, utility } = splitVariants(token)
    return OUTLINE_HIDDEN.test(utility) && !variants.some((variant) => FOCUS_VARIANT.test(variant))
  })
}

/** Comments are not scanned: a comment may name what it bans. */
export function outlineFindings(source: string, file: string): OutlineFinding[] {
  const sf = parseSource(source, file)
  const findings: OutlineFinding[] = []
  walkNodes(sf, (node) => {
    const text = literalText(node)
    if (text === undefined) return
    for (const match of restingOutlines(text)) {
      findings.push({ file, line: lineOf(sf, node), match, text: text.trim().slice(0, 80) })
    }
  })
  return findings
}

/** Every class in a source tree's literals that draws an outline at rest under forced colours. */
export function scanOutlines(dir: string): OutlineFinding[] {
  return sourceFiles(dir).flatMap((path) =>
    outlineFindings(readFileSync(path, "utf8"), relativePath(dir, path)),
  )
}
