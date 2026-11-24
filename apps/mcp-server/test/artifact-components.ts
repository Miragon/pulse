import path from "node:path"
import { format, resolveConfig } from "prettier"
import ts from "typescript"

/**
 * The component cheat sheet of the pulse-artifact skill
 * (`skills/pulse-artifact/references/components.md`), written from the declarations the packages
 * build (`dist/**\/*.d.ts`) with the TypeScript checker, so the props an agent reads are the props
 * the kit has. Only the curated names of SHEET below, the ones a page outside the web app composes
 * (the template `templates/claude-artifact` uses them); deprecated props stay out. The drift test
 * (`artifact-components.test.ts`) holds the committed file to this rendering after `^build`, and
 * `golden:update` rewrites it.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..")

/** The sheet's file in the plugin, from the repository root. */
export const SHEET_FILE = "apps/mcp-server/skills/pulse-artifact/references/components.md"

export interface SheetGroup {
  /** The import path a page names. */
  readonly from: string
  /** The declaration file of that entry, from the repository root. */
  readonly entry: string
  /** The exported names, in the order the sheet shows them. */
  readonly names: readonly string[]
}

/**
 * The names, by entry: what the template's page imports, the kit pieces the skill's design rules
 * name, and each own type their blocks name (`Fact` in `Facts`' props, `Translate` in
 * `createUseT`'s), so a reader finds every type a block names in the sheet; the render refuses a
 * sheet that names one it leaves out. A page reaches each through its package's `exports` only;
 * widget-shell's diagram and freshness names move into pulse-ui with Miragon/pulse#662 and #664,
 * and this list with them.
 */
export const SHEET: readonly SheetGroup[] = [
  {
    from: "@miragon/pulse-ui",
    entry: "packages/core/ui/dist/index.d.ts",
    names: [
      "WidgetHeader",
      "Facts",
      "Fact",
      "VersionChip",
      "SectionHeading",
      "StatusStrip",
      "StatusStripAction",
      "KpiGrid",
      "KpiGridHeader",
      "KpiCell",
      "KpiGridSkeleton",
      "ToneName",
      "ToneVariant",
      "CountFigure",
      "CountBadge",
      "StateLabel",
      "DataTable",
      "DataTableColumn",
      "RowActivation",
      "TableEmptyState",
      "NamedId",
      "ErrorState",
      "Skeleton",
      "Button",
      "Icon",
      "LocaleProvider",
      "useLocale",
      "createUseT",
      "Translate",
      "T",
      "cn",
    ],
  },
  {
    from: "@miragon/pulse-ui/format",
    entry: "packages/core/ui/dist/format/index.d.ts",
    names: [
      "setFormatLocale",
      "Count",
      "formatCount",
      "formatCompactCount",
      "formatNumber",
      "formatPercent",
      "formatDuration",
      "formatClock",
      "formatInstant",
      "formatTimestamp",
      "formatDate",
      "formatRelativeTime",
      "shortId",
      "truncate",
    ],
  },
  {
    from: "@miragon/pulse-ui/tones",
    entry: "packages/core/ui/dist/tones/index.d.ts",
    names: ["Situation", "SITUATION_TONES", "VERDICT_TONES"],
  },
  {
    from: "@miragon/pulse-blocks",
    entry: "packages/core/blocks/dist/index.d.ts",
    names: ["BadgeCluster", "BadgeLegend", "CountBadgeProps", "ScreenOpenHow"],
  },
  {
    from: "@miragon/pulse-screens",
    entry: "packages/core/screens/dist/index.d.ts",
    names: [
      "DiagramDecorations",
      "ElementBadgeData",
      "ElementDecorationData",
      "BadgeCountData",
      "CallLinkData",
      "CalledInstanceData",
      "DefinitionRefData",
      "InstanceScopeCode",
    ],
  },
  {
    from: "@miragon/pulse-widget-shell/widgets",
    entry: "packages/core/widget-shell/dist/ui/index.d.ts",
    names: [
      "useBpmnViewer",
      "BpmnViewerWithGet",
      "BpmnCanvas",
      "BpmnOverlays",
      "BpmnZoomControls",
      "parseBpmnNames",
      "readBpmnNames",
      "FreshnessStamp",
      "describeError",
      "PageHints",
      "isPermanentError",
    ],
  },
  {
    from: "@miragon/pulse-c7-core",
    entry: "packages/connectors/c7/c7-core/dist/index.d.ts",
    names: ["isRootIncident"],
  },
]

/**
 * The kit's types a block names that the sheet keeps as names, each with why a page needs no
 * more: a value the page passes on from a kit function the sheet leaves out, or a slice of
 * bpmn-js that widget-shell types for itself. The header lists them, so a reader knows they stay
 * out on purpose; every other own type a block names is in SHEET, or the render fails.
 */
export const NAMED_ONLY: Readonly<Record<string, string>> = {
  UiMessagesOverride: "the kit's own words per part, which a page leaves as they are",
  DataTableSelection: "a selection column, as `rowSelection` builds it",
  ColumnSizing: "columns a reader sizes by dragging, as `useColumnSizing` returns it",
  BpmnElementRegistry: 'bpmn-js\'s element registry, `viewer.get("elementRegistry")`',
  BpmnEventBus: 'bpmn-js\'s event bus, `viewer.get("eventBus")`',
  FitRect: "a box `{ x, y, width, height }` in diagram units, which widget-shell keeps to itself",
}

/** The packages whose declarations count as the kit's own: props from elsewhere (React's DOM props) stay out. */
const OWN_DIRS = [...new Set(SHEET.map((group) => path.dirname(group.entry).split("/dist")[0]))]
  .map((dir) => path.join(REPO_ROOT, dir, "dist"))
  .map((dir) => ts.sys.realpath?.(dir) ?? dir)

const PRINT =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope

/**
 * A union of literals up to this size is spelled out (`"h2" | "h3"`, the situations, the error
 * kinds); a longer one, such as the tone names with their aliases, keeps its name.
 */
const MAX_SPELLED_LITERALS = 15

const LITERAL =
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null

/** Whether `fileName` is a declaration file of one of the kit's packages. */
function isOwnFile(fileName: string): boolean {
  return OWN_DIRS.some((dir) => fileName.startsWith(`${dir}/`))
}

/** Every type name the kit's packages declare, exported or kept to a file. */
function ownTypeNames(program: ts.Program): ReadonlySet<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  for (const file of program.getSourceFiles()) if (isOwnFile(file.fileName)) visit(file)
  return names
}

/** The type parameters `declarations` declare, at any depth: names a block may use freely. */
function typeParameterNames(declarations: readonly ts.Declaration[]): ReadonlySet<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isTypeParameterDeclaration(node)) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  for (const declaration of declarations) visit(declaration)
  return names
}

/** A type as the checker prints it, its string literals emptied: the names left are its words. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g

/** A name in printed type text, never a member's key (`label:`, `label?:`). */
const TYPE_WORD = /\b[A-Za-z_]\w*\b(?!\??:)/g

class SheetWriter {
  private readonly checker: ts.TypeChecker
  private readonly ownNames: ReadonlySet<string>
  /** The entry being rendered and its type parameters. */
  private current = ""
  private scope: ReadonlySet<string> = new Set()
  /** The unlisted own types being spelled out: one that holds itself prints its name instead. */
  private readonly spelling = new Set<ts.Type>()
  /** Each own type a block names that the sheet defines nowhere, with the first entry naming it. */
  readonly missing = new Map<string, string>()

  constructor(
    private readonly program: ts.Program,
    private readonly defined: ReadonlySet<string>,
  ) {
    this.checker = program.getTypeChecker()
    this.ownNames = ownTypeNames(program)
  }

  /** Whether the sheet defines `name`, or keeps it a name on purpose (NAMED_ONLY). */
  private listed(name: string): boolean {
    return this.defined.has(name) || Object.hasOwn(NAMED_ONLY, name)
  }

  /** `text`, a type as the checker printed it, once each own type it names is checked. */
  private named(text: string): string {
    for (const [word] of text.replace(STRING_LITERAL, '""').matchAll(TYPE_WORD)) {
      if (!this.ownNames.has(word) || this.listed(word) || this.scope.has(word)) continue
      if (!this.missing.has(word)) this.missing.set(word, this.current)
    }
    return text
  }

  /** The exported symbol `name` of the entry file `entry`, its alias resolved. */
  exported(entry: string, name: string): ts.Symbol {
    const file = this.program.getSourceFile(path.join(REPO_ROOT, entry))
    const module = file && this.checker.getSymbolAtLocation(file)
    if (module === undefined) throw new Error(`${entry} is not built: run pnpm build first.`)
    const symbol = this.checker.getExportsOfModule(module).find((each) => each.name === name)
    if (symbol === undefined) throw new Error(`${entry} exports no ${name}.`)
    return symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol
  }

  /** Whether `symbol` names a type only (an interface or an alias), imported with `type`. */
  isType(symbol: ts.Symbol): boolean {
    return (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0
  }

  /** One entry of the sheet: its declaration as TypeScript, its JSDoc kept. */
  render(symbol: ts.Symbol, name: string): string {
    this.current = name
    this.scope = typeParameterNames(symbol.declarations ?? [])
    const doc = this.comment(symbol.getDocumentationComment(this.checker), "")
    if (this.isType(symbol)) {
      const type = this.checker.getDeclaredTypeOfSymbol(symbol)
      const params = this.typeParameters(this.ownTypeArguments(symbol, type))
      if (symbol.flags & ts.SymbolFlags.Interface) {
        return `${doc}interface ${name}${params} ${this.object(this.checker.getPropertiesOfType(type), "")}`
      }
      return `${doc}type ${name}${params} = ${this.named(this.checker.typeToString(type, undefined, PRINT | ts.TypeFormatFlags.InTypeAlias))}`
    }
    if (symbol.flags & ts.SymbolFlags.Class) return `${doc}${this.classOf(symbol, name)}`
    const type = this.checker.getTypeOfSymbol(symbol)
    const signatures = type.getCallSignatures()
    if (signatures.length === 0) {
      return `${doc}declare const ${name}: ${this.named(this.checker.typeToString(type, undefined, PRINT))}`
    }
    return signatures
      .map((signature, index) => {
        const own = this.comment(signature.getDocumentationComment(this.checker), "")
        const lead = index === 0 ? doc || own : own === doc ? "" : own
        return `${lead}declare function ${name}${this.signature(signature)}`
      })
      .join("\n")
  }

  /**
   * The type parameters `symbol` declares: an alias's own, never those of the alias it is
   * (`PageHints` is a `Readonly<…>`, whose arguments are no parameters of PageHints).
   */
  private ownTypeArguments(symbol: ts.Symbol, type: ts.Type): readonly ts.Type[] {
    if (symbol.flags & ts.SymbolFlags.TypeAlias) {
      return type.aliasSymbol === symbol ? (type.aliasTypeArguments ?? []) : []
    }
    return (type as ts.InterfaceType).typeParameters ?? []
  }

  private typeParameters(types: readonly ts.Type[]): string {
    return types.length === 0
      ? ""
      : `<${types.map((each) => this.checker.typeToString(each)).join(", ")}>`
  }

  private classOf(symbol: ts.Symbol, name: string): string {
    const type = this.checker.getTypeOfSymbol(symbol)
    const statics = this.checker
      .getPropertiesOfType(type)
      .filter((member) => member.flags & ts.SymbolFlags.Method)
      .filter((member) => !this.isPrivate(member))
      .flatMap((member) =>
        this.checker
          .getTypeOfSymbol(member)
          .getCallSignatures()
          .map(
            (signature) =>
              `${this.comment(member.getDocumentationComment(this.checker), "  ")}  static ${member.name}${this.signature(signature)}`,
          ),
      )
    return `declare class ${name} {\n${statics.join("\n")}\n}`
  }

  private isPrivate(member: ts.Symbol): boolean {
    return (member.declarations ?? []).some(
      (declaration) => ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private,
    )
  }

  /** `<T>(props: {…}): Result`, an own object parameter or result spelled out. */
  private signature(signature: ts.Signature): string {
    const params = signature.getParameters().map((param) => {
      const declaration = param.valueDeclaration as ts.ParameterDeclaration | undefined
      const optional = declaration !== undefined && this.checker.isOptionalParameter(declaration)
      const type = this.checker.getTypeOfSymbol(param)
      const label =
        declaration && ts.isObjectBindingPattern(declaration.name) ? "props" : param.name
      const rest = declaration?.dotDotDotToken === undefined ? "" : "..."
      return `${rest}${label}${optional ? "?" : ""}: ${this.typeText(type, optional, "", true)}`
    })
    const result = this.typeText(signature.getReturnType(), false, "", true)
    const generics = signature.getTypeParameters() ?? []
    return `${this.typeParameters(generics)}(${params.join(", ")}): ${result}`
  }

  /** Whether `symbol` is declared in one of the kit's packages. */
  private isOwn(symbol: ts.Symbol): boolean {
    return (symbol.declarations ?? []).some((declaration) =>
      isOwnFile(declaration.getSourceFile().fileName),
    )
  }

  private isDeprecated(symbol: ts.Symbol): boolean {
    return symbol.getJsDocTags(this.checker).some((tag) => tag.name === "deprecated")
  }

  /** An object type whose members the sheet spells out: the kit's own, no function, no array. */
  private isOwnObject(type: ts.Type): boolean {
    if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection()) return false
    if (type.getCallSignatures().length > 0 || this.checker.isArrayLikeType(type)) return false
    const props = this.checker.getPropertiesOfType(type)
    return props.length > 0 && props.some((prop) => this.isOwn(prop))
  }

  /**
   * A type as the sheet prints it. With `expand`, an own object becomes its members and a union
   * of own objects keeps their shared members once and the rest per branch, so a pair of props
   * that comes together (`situation` with `label`) reads as one.
   */
  private typeText(type: ts.Type, optional: boolean, indent: string, expand = false): string {
    if (expand && type.isUnion()) {
      const absent = ts.TypeFlags.Undefined | ts.TypeFlags.Null
      const branches = type.types.filter((each) => !(each.flags & absent))
      const empty = type.types
        .filter((each) => each.flags & absent && !(optional && each.flags & ts.TypeFlags.Undefined))
        .map((each) => ` | ${this.checker.typeToString(each)}`)
        .join("")
      if (branches.length > 1 && branches.every((each) => this.isOwnObject(each))) {
        return `${this.union(branches, indent)}${empty}`
      }
      const [only] = branches
      if (branches.length === 1 && only !== undefined && this.isOwnObject(only)) {
        return `${this.object(this.checker.getPropertiesOfType(only), indent)}${empty}`
      }
    }
    if (expand && this.isOwnObject(type)) {
      return this.object(this.checker.getPropertiesOfType(type), indent)
    }
    const unlisted = this.unlisted(type, optional, indent)
    if (unlisted !== undefined) return unlisted
    if (
      type.isUnion() &&
      type.types.length <= MAX_SPELLED_LITERALS &&
      type.types.every((each) => each.flags & LITERAL)
    ) {
      return this.literals(type.types, optional)
    }
    if (this.isJsxElement(type)) return "JSX.Element"
    if (type.isUnion() && type.types.some((each) => this.isJsxElement(each))) {
      return type.types
        .filter((each) => !(optional && each.flags & ts.TypeFlags.Undefined))
        .map((each) =>
          this.isJsxElement(each) ? "JSX.Element" : this.named(this.checker.typeToString(each)),
        )
        .join(" | ")
    }
    const text = this.named(this.checker.typeToString(type, undefined, PRINT))
    return optional ? unwrap(text.replace(/ \| undefined$/, "")) : text
  }

  /**
   * An own object type by a name the sheet does not define (an interface its package keeps to
   * itself, such as `BpmnZoomControls`' labels), spelled out where a member uses it, so the reader
   * sees its members instead of a name they cannot look up. `undefined` for any other type.
   */
  private unlisted(type: ts.Type, optional: boolean, indent: string): string | undefined {
    const absent = ts.TypeFlags.Undefined | ts.TypeFlags.Null
    const branches = type.isUnion() ? type.types.filter((each) => !(each.flags & absent)) : [type]
    const [only] = branches
    if (branches.length !== 1 || only === undefined || !this.isOwnObject(only)) return undefined
    const named = only.aliasSymbol ?? only.getSymbol()
    if (named === undefined || !this.isOwn(named) || named.name.startsWith("__")) return undefined
    if (this.listed(named.name) || this.spelling.has(only)) return undefined
    const empty = type.isUnion()
      ? type.types
          .filter(
            (each) => each.flags & absent && !(optional && each.flags & ts.TypeFlags.Undefined),
          )
          .map((each) => ` | ${this.checker.typeToString(each)}`)
          .join("")
      : ""
    this.spelling.add(only)
    try {
      return `${this.object(this.checker.getPropertiesOfType(only), indent)}${empty}`
    } finally {
      this.spelling.delete(only)
    }
  }

  /** React's `JSX.Element`, which the checker prints as a bare `Element`. */
  private isJsxElement(type: ts.Type): boolean {
    const declaration = type.getSymbol()?.declarations?.[0]
    return (
      type.getSymbol()?.name === "Element" &&
      declaration !== undefined &&
      declaration.getSourceFile().fileName.includes("/@types/react/")
    )
  }

  private literals(types: readonly ts.Type[], optional: boolean): string {
    const kept = types.filter((each) => !(optional && each.flags & ts.TypeFlags.Undefined))
    const words = kept.map((each) => this.checker.typeToString(each))
    const bool = words.includes("true") && words.includes("false")
    const rest = words.filter((word) => !(bool && (word === "true" || word === "false")))
    return [...rest, ...(bool ? ["boolean"] : [])].join(" | ")
  }

  private union(branches: readonly ts.Type[], indent: string): string {
    const lines = branches.map(
      (branch) =>
        new Map(this.members(this.checker.getPropertiesOfType(branch), `${indent}  `).entries()),
    )
    const [first = new Map<string, string>()] = lines
    const shared = [...first.entries()].filter(([key, line]) =>
      lines.every((each) => each.get(key) === line),
    )
    const sharedKeys = new Set(shared.map(([key]) => key))
    const own = lines.map((each) => [...each.entries()].filter(([key]) => !sharedKeys.has(key)))
    const block = (entries: readonly (readonly [string, string])[]) =>
      `{\n${entries.map(([, line]) => line).join("\n")}\n${indent}}`
    const alternatives = own.map((entries) => block(entries)).join(" | ")
    return shared.length === 0 ? alternatives : `${block(shared)} & (${alternatives})`
  }

  private object(props: readonly ts.Symbol[], indent: string): string {
    const members = [...this.members(props, `${indent}  `).values()]
    const foreign = props.some((prop) => !this.isOwn(prop))
    const rest = foreign ? [`${indent}  // …and the props of the element it renders`] : []
    return `{\n${[...members, ...rest].join("\n")}\n${indent}}`
  }

  /** Each own, current member as its JSDoc and its line, keyed by name. */
  private members(props: readonly ts.Symbol[], indent: string): Map<string, string> {
    const lines = new Map<string, string>()
    for (const prop of props) {
      if (!this.isOwn(prop) || this.isDeprecated(prop)) continue
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0
      const type = declaration
        ? this.checker.getTypeOfSymbolAtLocation(prop, declaration)
        : this.checker.getTypeOfSymbol(prop)
      const readonly =
        declaration !== undefined &&
        ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly
          ? "readonly "
          : ""
      const doc = this.comment(prop.getDocumentationComment(this.checker), indent)
      const text = this.typeText(type, optional, indent)
      lines.set(prop.name, `${doc}${indent}${readonly}${prop.name}${optional ? "?" : ""}: ${text}`)
    }
    return lines
  }

  /** A JSDoc block at `indent`, empty without documentation. */
  private comment(parts: readonly ts.SymbolDisplayPart[], indent: string): string {
    const text = ts
      .displayPartsToString(parts as ts.SymbolDisplayPart[])
      .replace(
        /\{@link(?:code|plain)?\s+([^}|\s]+)(?:\s*\|\s*([^}]*?))?\s*\}/g,
        (_, target, label) => String(label ?? target),
      )
      .trim()
    if (text === "") return ""
    const single = `${indent}/** ${text} */`
    if (!text.includes("\n") && single.length <= COMMENT_WIDTH) return `${single}\n`
    const lines = text.split("\n").map((line) => `${indent} * ${line}`.trimEnd())
    return `${indent}/**\n${lines.join("\n")}\n${indent} */\n`
  }
}

/** The repository's print width: a one-line JSDoc that fits stays on one line. */
const COMMENT_WIDTH = 100

/** `(() => void)` without the parentheses a dropped `| undefined` leaves around it. */
function unwrap(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text
  let depth = 0
  for (const [index, char] of [...text].entries()) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (depth === 0 && index < text.length - 1) return text
  }
  return text.slice(1, -1)
}

const HEADER = `<!-- Generated from the packages' declarations by apps/mcp-server/test/artifact-components.ts. Do not edit: run pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update. -->

# Components and helpers

The props and signatures of the names a page on Pulse composes, read from the declarations of the
packages at the version this plugin carries. Each block is TypeScript: \`declare function\` for a
component (its one argument is its props) or a function, \`interface\` and \`type\` for data. A prop
written \`a?: T\` may be left out; where two props come together, the block shows the alternatives
as a union. Deprecated props are left out, and a component that passes the rest on to its element
ends with a comment saying so.

Every type of the kit a block names has a block of its own, or, where its package keeps it to
itself, is spelled out at the prop that uses it. These few stay names, since a page needs no more
of them:

${Object.entries(NAMED_ONLY)
  .map(([name, why]) => `- \`${name}\`: ${why}`)
  .join("\n")}

Import each name from the entry its section names, never from a \`dist/\` path.`

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
}

/**
 * The declarations parsed once per process: every rendering builds a program and a checker of
 * its own, over the same files (the kit's, React's and lucide's typings), so each file is parsed
 * and bound once, as the language service's document registry reuses them.
 */
const parsed = new Map<string, ts.SourceFile>()

function cachingHost(): ts.CompilerHost {
  const host = ts.createCompilerHost(COMPILER_OPTIONS)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, ...rest) => {
    const hit = parsed.get(fileName)
    if (hit !== undefined) return hit
    const file = read(fileName, ...rest)
    if (file !== undefined) parsed.set(fileName, file)
    return file
  }
  return host
}

/** The sheet as Markdown, before Prettier: `groups` (by default SHEET) from the built declarations. */
export function renderComponentsSheet(groups: readonly SheetGroup[] = SHEET): string {
  const program = ts.createProgram(
    groups.map((group) => path.join(REPO_ROOT, group.entry)),
    COMPILER_OPTIONS,
    cachingHost(),
  )
  const writer = new SheetWriter(program, new Set(groups.flatMap((group) => group.names)))
  const sections = groups.map((group) => {
    const symbols = group.names.map((name) => [name, writer.exported(group.entry, name)] as const)
    const names = symbols.map(([name, symbol]) => (writer.isType(symbol) ? `type ${name}` : name))
    const imports = `\`\`\`ts\nimport { ${names.join(", ")} } from "${group.from}"\n\`\`\``
    const entries = symbols.map(
      ([name, symbol]) => `### ${name}\n\n\`\`\`ts\n${writer.render(symbol, name)}\n\`\`\``,
    )
    return `## ${group.from}\n\n${imports}\n\n${entries.join("\n\n")}`
  })
  if (writer.missing.size > 0) {
    const named = [...writer.missing].map(([type, by]) => `${type} (named by ${by})`)
    throw new Error(
      `The sheet names types it defines nowhere: ${named.join(", ")}. Add each to SHEET under the entry that exports it, so a reader finds it in the sheet.`,
    )
  }
  return `${HEADER}\n\n${sections.join("\n\n")}\n`
}

/** Where the plugin holds the sheet. */
export const SHEET_PATH = path.join(REPO_ROOT, SHEET_FILE)

/** The sheet as the plugin holds it: rendered, then formatted with the repository's Prettier config. */
export async function componentsSheet(): Promise<string> {
  const config = (await resolveConfig(SHEET_PATH)) ?? {}
  return format(renderComponentsSheet(), { ...config, filepath: SHEET_PATH })
}
