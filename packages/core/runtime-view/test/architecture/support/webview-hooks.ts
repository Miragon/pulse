import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

export interface HookFinding {
  readonly file: string
  readonly line: number
  readonly className: string
}

const LIBRARY_CLASS = /^(djs|bjs|bio|cd)-/
const DIAGRAM_MARKER = "pulse-"
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g
const TAGS =
  "a|article|button|code|dialog|div|g|header|input|label|li|main|p|pre|section|select|span|svg|table|tbody|td|textarea|th|tr|ul"
const SELECTOR_CLASS = new RegExp(
  `(?:^|[\\s,>+~(:[\\]*]|(?<![\\w-])(?:${TAGS}))\\.([A-Za-z_][\\w-]*)`,
  "g",
)
const CSS_CLASS = /\.([A-Za-z_][\w-]*)/g
const CLASS_ACCESS = /\b(?:classList|className)\b/g
const CLASS_ATTRIBUTE = /class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g

export class WebviewHooks {
  static sourcesUnder(root: string, extensions: readonly string[]): Map<string, string> {
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
      extensions.some((extension) => file.endsWith(extension)),
    )
    return new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]))
  }

  static classNames(styles: Iterable<string>, components: Iterable<string>): Set<string> {
    const names = new Set<string>()
    for (const css of styles) {
      for (const [, name] of WebviewHooks.withoutComments(css).matchAll(CSS_CLASS)) {
        names.add(name ?? "")
      }
    }
    for (const source of components) {
      for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
        WebviewHooks.addTokens(names, match.slice(1).join(" "))
      }
    }
    return new Set(
      [...names].filter((name) => /^[A-Za-z_]/.test(name) && !LIBRARY_CLASS.test(name)),
    )
  }

  static findings(file: string, source: string, classes: ReadonlySet<string>): HookFinding[] {
    const found: HookFinding[] = []
    for (const literal of source.matchAll(STRING_LITERAL)) {
      for (const className of WebviewHooks.selectorClasses(literal[0].slice(1, -1), classes)) {
        found.push({ file, line: WebviewHooks.lineAt(source, literal.index), className })
      }
    }
    for (const access of source.matchAll(CLASS_ACCESS)) {
      const className = WebviewHooks.expectedClass(source.slice(access.index, access.index + 120))
      if (
        className !== undefined &&
        classes.has(className) &&
        !className.startsWith(DIAGRAM_MARKER)
      ) {
        found.push({ file, line: WebviewHooks.lineAt(source, access.index), className })
      }
    }
    return found.sort((first, second) => first.line - second.line)
  }

  static relativeTo(root: string, path: string): string {
    return relative(root, path).split("\\").join("/")
  }

  private static selectorClasses(text: string, classes: ReadonlySet<string>): string[] {
    return [...text.matchAll(SELECTOR_CLASS)]
      .map(([, name]) => name ?? "")
      .filter((name) => classes.has(name))
  }

  private static expectedClass(after: string): string | undefined {
    const literal = new RegExp(STRING_LITERAL.source).exec(after)
    return literal?.[0].slice(1, -1).trim()
  }

  private static lineAt(source: string, index: number): number {
    return source.slice(0, index).split("\n").length
  }

  private static addTokens(names: Set<string>, text: string): void {
    for (const token of text.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      if (/^[A-Za-z_][\w-]*[\w]$/.test(token)) {
        names.add(token)
      }
    }
  }

  private static withoutComments(css: string): string {
    return css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "")
      .replace(/"[^"]*"|'[^']*'/g, "")
  }
}
