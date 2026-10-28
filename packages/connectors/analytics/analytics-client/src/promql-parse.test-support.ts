// Anything outside the supported subset throws instead of parsing to something approximate.

type TokenKind = "ident" | "number" | "duration" | "string" | "range" | "punct" | "eof"

interface Token {
  kind: TokenKind
  text: string
  pos: number
}

const LEXEMES: Array<[TokenKind, RegExp]> = [
  // A Grafana interval variable is a duration too (`offset $__range`).
  [
    "duration",
    /(?:\d+(?:ms|[smhdwy]))+(?![A-Za-z0-9_])|\$__(?:rate_interval|interval|range)(?![A-Za-z0-9_])/y,
  ],
  ["number", /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y],
  ["ident", /[A-Za-z_:][A-Za-z0-9_:]*/y],
  ["string", /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/y],
  // Range / subquery brackets stay raw: their content (`5m`, `$__range`,
  // `86400s`, `5m:1m`) never names a label.
  ["range", /\[[^\]]*\]/y],
  ["punct", /=~|!~|!=|==|>=|<=|[(){},=<>+\-*/%^@]/y],
]

const WHITESPACE = /\s+/y

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  while (pos < src.length) {
    WHITESPACE.lastIndex = pos
    if (WHITESPACE.test(src)) {
      pos = WHITESPACE.lastIndex
      continue
    }
    const token = lexemeAt(src, pos)
    tokens.push(token)
    pos += token.text.length
  }
  tokens.push({ kind: "eof", text: "", pos })
  return tokens
}

function lexemeAt(src: string, pos: number): Token {
  for (const [kind, pattern] of LEXEMES) {
    pattern.lastIndex = pos
    const match = pattern.exec(src)
    if (match) return { kind, text: match[0], pos }
  }
  throw new Error(`PromQL: unexpected "${src[pos]}" at ${pos} in: ${src}`)
}

/** String literal → value (Go-style escapes reduced to the escaped character). */
function unquote(text: string): string {
  const body = text.slice(1, -1)
  return text.startsWith("`") ? body : body.replace(/\\(.)/g, "$1")
}

export interface Matcher {
  label: string
  op: "=" | "!=" | "=~" | "!~"
  value: string
}

export interface Grouping {
  mode: "by" | "without"
  labels: string[]
}

export interface VectorMatching {
  mode?: "on" | "ignoring"
  labels: string[]
  group?: "group_left" | "group_right"
  include: string[]
}

/**
 * Parsed expression. Parentheses, unary signs and the range / `offset` / `@`
 * postfixes are folded into their operand — none of them changes the label set.
 */
export type PromNode =
  | { type: "number" }
  | { type: "string"; value: string }
  | { type: "selector"; name: string | undefined; matchers: Matcher[] }
  | { type: "call"; func: string; args: PromNode[] }
  | { type: "aggregate"; op: string; grouping?: Grouping; param?: PromNode; expr: PromNode }
  | { type: "binary"; op: string; lhs: PromNode; rhs: PromNode; matching?: VectorMatching }

const AGGREGATORS = new Set(
  "sum min max avg group stddev stdvar count count_values bottomk topk quantile limitk limit_ratio".split(
    " ",
  ),
)

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  or: 1,
  and: 2,
  unless: 2,
  "==": 3,
  "!=": 3,
  "<=": 3,
  "<": 3,
  ">=": 3,
  ">": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
  atan2: 5,
  "^": 6,
}

const MATCH_OPS = new Set(["=", "!=", "=~", "!~"])

class Parser {
  private i = 0

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  parse(): PromNode {
    const node = this.parseExpr(1)
    this.expectKind("eof")
    return node
  }

  private peek(): Token {
    return this.tokens[this.i]
  }

  private next(): Token {
    const token = this.tokens[this.i]
    if (token.kind !== "eof") this.i++
    return token
  }

  private peekIs(text: string): boolean {
    const t = this.peek()
    return (t.kind === "ident" || t.kind === "punct") && t.text === text
  }

  private accept(text: string): boolean {
    if (!this.peekIs(text)) return false
    this.i++
    return true
  }

  private expect(text: string): void {
    if (!this.accept(text)) throw this.error(`"${text}"`)
  }

  private expectKind(kind: TokenKind): Token {
    if (this.peek().kind !== kind) throw this.error(kind)
    return this.next()
  }

  private error(expected: string): Error {
    const t = this.peek()
    return new Error(
      `PromQL: expected ${expected} at ${t.pos}, got "${t.text || "<end>"}" in: ${this.src}`,
    )
  }

  private binaryPrecedence(): number | undefined {
    const t = this.peek()
    if (t.kind !== "punct" && t.kind !== "ident") return undefined
    return Object.hasOwn(BINARY_PRECEDENCE, t.text) ? BINARY_PRECEDENCE[t.text] : undefined
  }

  private parseExpr(minPrec: number): PromNode {
    let lhs = this.parseUnary()
    for (;;) {
      const prec = this.binaryPrecedence()
      if (prec === undefined || prec < minPrec) return lhs
      const op = this.next().text
      const matching = this.parseVectorMatching()
      // `^` is right-associative; every other operator binds left.
      const rhs = this.parseExpr(op === "^" ? prec : prec + 1)
      lhs = { type: "binary", op, lhs, rhs, matching }
    }
  }

  private parseVectorMatching(): VectorMatching | undefined {
    this.accept("bool")
    let mode: VectorMatching["mode"]
    let labels: string[] = []
    if (this.peekIs("on") || this.peekIs("ignoring")) {
      mode = this.next().text as "on" | "ignoring"
      labels = this.parseLabelList()
    }
    let group: VectorMatching["group"]
    let include: string[] = []
    if (this.peekIs("group_left") || this.peekIs("group_right")) {
      group = this.next().text as "group_left" | "group_right"
      if (this.peekIs("(")) include = this.parseLabelList()
    }
    return mode || group ? { mode, labels, group, include } : undefined
  }

  private parseUnary(): PromNode {
    if (this.accept("-") || this.accept("+")) return this.parseUnary()
    return this.parsePostfix(this.parsePrimary())
  }

  private parsePostfix(node: PromNode): PromNode {
    for (;;) {
      if (this.peek().kind === "range") {
        this.next()
      } else if (this.accept("offset")) {
        this.accept("-")
        this.expectKind("duration")
      } else if (this.accept("@")) {
        this.parseAtModifier()
      } else {
        return node
      }
    }
  }

  private parseAtModifier(): void {
    if (this.peek().kind === "number") {
      this.next()
      return
    }
    if (!this.accept("start") && !this.accept("end")) throw this.error("@ timestamp")
    this.expect("(")
    this.expect(")")
  }

  private parsePrimary(): PromNode {
    const t = this.peek()
    if (t.kind === "number") {
      this.next()
      return { type: "number" }
    }
    if (t.kind === "string") {
      this.next()
      return { type: "string", value: unquote(t.text) }
    }
    if (t.kind === "ident") return this.parseIdentExpr(this.next().text)
    if (this.accept("{")) return this.parseSelectorBody(undefined)
    if (!this.accept("(")) throw this.error("expression")
    const inner = this.parseExpr(1)
    this.expect(")")
    return inner
  }

  private parseIdentExpr(name: string): PromNode {
    const isAggregation =
      AGGREGATORS.has(name) && (this.peekIs("(") || this.peekIs("by") || this.peekIs("without"))
    if (isAggregation) return this.parseAggregate(name)
    if (this.peekIs("(")) return { type: "call", func: name, args: this.parseArgs() }
    if (this.accept("{")) return this.parseSelectorBody(name)
    return { type: "selector", name, matchers: [] }
  }

  private parseAggregate(op: string): PromNode {
    const before = this.parseGrouping()
    const args = this.parseArgs()
    const grouping = before ?? this.parseGrouping()
    if (args.length < 1 || args.length > 2) throw this.error(`1-2 arguments to ${op}`)
    const expr = args[args.length - 1]
    const param = args.length === 2 ? args[0] : undefined
    return { type: "aggregate", op, grouping, param, expr }
  }

  private parseGrouping(): Grouping | undefined {
    if (!this.peekIs("by") && !this.peekIs("without")) return undefined
    const mode = this.next().text as "by" | "without"
    return { mode, labels: this.parseLabelList() }
  }

  private parseLabelList(): string[] {
    this.expect("(")
    const labels: string[] = []
    while (!this.accept(")")) {
      labels.push(this.expectKind("ident").text)
      if (!this.accept(",")) {
        this.expect(")")
        break
      }
    }
    return labels
  }

  private parseArgs(): PromNode[] {
    this.expect("(")
    const args: PromNode[] = []
    if (this.accept(")")) return args
    do {
      args.push(this.parseExpr(1))
    } while (this.accept(","))
    this.expect(")")
    return args
  }

  private parseSelectorBody(name: string | undefined): PromNode {
    const matchers: Matcher[] = []
    while (!this.accept("}")) {
      const label = this.expectKind("ident").text
      const op = this.peek().text
      if (this.peek().kind !== "punct" || !MATCH_OPS.has(op)) {
        throw this.error("label matcher operator")
      }
      this.next()
      const value = unquote(this.expectKind("string").text)
      matchers.push({ label, op: op as Matcher["op"], value })
      if (!this.accept(",")) {
        this.expect("}")
        break
      }
    }
    const byName = matchers.find((m) => m.label === "__name__" && m.op === "=")?.value
    return { type: "selector", name: name ?? byName, matchers }
  }
}

export function parsePromql(src: string): PromNode {
  return new Parser(tokenize(src), src).parse()
}
