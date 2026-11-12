import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sourceTexts } from "@miragon/pulse-ui/testing"
import ts from "typescript"

interface PromiseRule {
  readonly pattern: RegExp
  readonly marker: string
  readonly probes: readonly string[]
}

interface Sentence {
  readonly text: string
  readonly parts: readonly string[]
}

interface Piece {
  readonly text: string
  readonly part: boolean
}

const NEGATION = String.raw`(?:\b(?:not|no|never|cannot)\b|n['’]t\b)`

const WITHIN_THE_SENTENCE = String.raw`(?:(?![.!?](?:\s|$))[\s\S])*?`

const RULES: readonly PromiseRule[] = [
  {
    pattern: new RegExp(String.raw`${NEGATION}${WITHIN_THE_SENTENCE}\byet\b`, "i"),
    marker: "not … yet",
    probes: ["variable columns are not supported yet", "Pulse does not read auth.type oauth yet."],
  },
  {
    pattern:
      /(?<!\bas\s)\bfollows?(?=\s*(?:[.;:,!)]|$)|\s+(?:in|with|soon|next|later|once|after)\b|\s+v?\d)|\bwill\s+follow\b/i,
    marker: "follows",
    probes: [
      "This client connects with basic authentication or none; OAuth2 follows.",
      "OAuth2 follows in 0.29.",
      "OAuth2 follows, until then use basic authentication.",
      "Writes on remote engines will follow.",
    ],
  },
  {
    pattern: /\blater\b/i,
    marker: "later",
    probes: ["Pulse moves tokens at an event-based gateway in a later version."],
  },
  { pattern: /\bsoon\b/i, marker: "soon", probes: ["Coming soon"] },
  {
    pattern: /\b(?:future|upcoming|roadmap)\b/i,
    marker: "future",
    probes: ["Boards show variables in a future release."],
  },
  {
    pattern: /\b(?:planned|coming)\b/i,
    marker: "planned",
    probes: ["Writes on remote engines are planned.", "OAuth2 is coming."],
  },
  {
    pattern:
      /\bnext\s+(?:release|version|update)\b|\b(?:in|with)\s+(?:this|the\s+current)\s+(?:release|version)\b|\b(?:in|with|from|until)\s+(?:v\d|(?:release|version)\s+v?\d)/i,
    marker: "a release",
    probes: [
      "Variable columns arrive with the next release.",
      "Writes are not available in this version.",
      "Not supported in v1.",
    ],
  },
  {
    pattern: /\bfor\s+(?:now|the\s+time\s+being)\b|\bas\s+of\s+now\b/i,
    marker: "for now",
    probes: ["Read-only for now.", "Pulse reads basic credentials only, for the time being."],
  },
  {
    pattern: /\bcurrently\b|\bat\s+the\s+moment\b/i,
    marker: "currently",
    probes: [
      "Pulse currently reads basic credentials only.",
      "Pulse cannot do this at the moment.",
    ],
  },
  {
    pattern:
      /\bwill\s+(?:be\s+)?(?:support|supported|add|added|available)\b|\b(?:is|are)\s+going\s+to\b/i,
    marker: "will support",
    probes: ["Pulse will support OAuth2.", "Pulse is going to support OAuth2."],
  },
]

const VALUE = "{value}"

const SENTENCE_END = ". "

const INLINE_TAGS: ReadonlySet<string> = new Set(
  "a abbr b cite code em i kbd mark q s small span strong sub sup time u var".split(" "),
)

export class PromiseWords {
  static scan(
    dir: string,
    allowed: Readonly<Record<string, string>>,
    aside: readonly string[] = [],
  ): string[] {
    const texts = PromiseWords.read(dir, aside)
    return [
      ...PromiseWords.findings(texts, allowed),
      ...Object.entries(SplitSentences.of(dir, PromiseWords.filesOf(texts))).flatMap(
        ([key, sentence]) => PromiseWords.sentenceFindings(key, sentence, allowed),
      ),
    ]
  }

  static texts(dir: string, aside: readonly string[] = []): string[] {
    const texts = PromiseWords.read(dir, aside)
    const sentences = SplitSentences.of(dir, PromiseWords.filesOf(texts))
    return [...Object.values(texts), ...Object.values(sentences).map((sentence) => sentence.text)]
  }

  static findings(
    texts: Readonly<Record<string, string>>,
    allowed: Readonly<Record<string, string>>,
  ): string[] {
    return Object.entries(texts).flatMap(([key, text]) =>
      PromiseWords.reported(key, text, PromiseWords.markersOf(text, allowed)),
    )
  }

  static jsonTexts(value: unknown, key: string): Record<string, string> {
    return Object.fromEntries(PromiseWords.jsonEntries(value, key))
  }

  static allowanceFindings(
    texts: readonly string[],
    allowed: Readonly<Record<string, string>>,
  ): string[] {
    return Object.entries(allowed).flatMap(([phrase, reason]) => {
      if (PromiseWords.markersOf(phrase, {}).length === 0) {
        return [`"${phrase}": spares no promise word (${reason})`]
      }
      return texts.some((text) => text.includes(phrase))
        ? []
        : [`"${phrase}": unused allowance (${reason})`]
    })
  }

  static blindRules(): string[] {
    return RULES.flatMap((rule) => rule.probes.filter((probe) => !rule.pattern.test(probe)))
  }

  private static read(dir: string, aside: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      Object.entries(sourceTexts(dir)).filter(
        ([key]) => !aside.some((folder) => key.startsWith(folder)),
      ),
    )
  }

  private static filesOf(texts: Readonly<Record<string, string>>): string[] {
    return [...new Set(Object.keys(texts).map((key) => key.replace(/:\d+:\d+$/, "")))]
  }

  private static sentenceFindings(
    key: string,
    sentence: Sentence,
    allowed: Readonly<Record<string, string>>,
  ): string[] {
    const known = new Set(sentence.parts.flatMap((part) => PromiseWords.markersOf(part, allowed)))
    const markers = PromiseWords.markersOf(sentence.text, allowed)
    return PromiseWords.reported(
      key,
      sentence.text,
      markers.filter((marker) => !known.has(marker)),
    )
  }

  private static reported(key: string, text: string, markers: readonly string[]): string[] {
    return markers.length === 0
      ? []
      : [`${key}: "${text}" promises a later feature (${markers.join(", ")})`]
  }

  private static markersOf(text: string, allowed: Readonly<Record<string, string>>): string[] {
    const rest = Object.keys(allowed).reduce((left, phrase) => left.split(phrase).join(" "), text)
    return RULES.filter((rule) => rule.pattern.test(rest)).map((rule) => rule.marker)
  }

  private static jsonEntries(value: unknown, key: string): [string, string][] {
    if (typeof value === "string") {
      return [[key, value]]
    }
    if (Array.isArray(value)) {
      return value.flatMap((item: unknown, index: number) =>
        PromiseWords.jsonEntries(item, `${key}[${index}]`),
      )
    }
    if (typeof value === "object" && value !== null) {
      return Object.entries(value).flatMap(([name, item]: [string, unknown]) =>
        PromiseWords.jsonEntries(item, `${key}.${name}`),
      )
    }
    return []
  }
}

class SplitSentences {
  static of(dir: string, files: readonly string[]): Record<string, Sentence> {
    return Object.fromEntries(files.flatMap((file) => SplitSentences.inFile(dir, file)))
  }

  private static inFile(dir: string, file: string): [string, Sentence][] {
    const path = join(dir, file)
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      kind,
    )
    const found: [string, Sentence][] = []
    const visit = (node: ts.Node): void => {
      const sentence = SplitSentences.sentenceOf(node)
      if (sentence !== undefined) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
        found.push([`${file}:${line + 1}:${character + 1}`, sentence])
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  private static sentenceOf(node: ts.Node): Sentence | undefined {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      return SplitSentences.joined(SplitSentences.childPieces(node.children))
    }
    if (SplitSentences.isConcatenation(node) && !SplitSentences.isConcatenation(node.parent)) {
      return SplitSentences.joined(SplitSentences.operandPieces(node))
    }
    return undefined
  }

  private static joined(pieces: readonly Piece[]): Sentence | undefined {
    const filled = pieces.filter((piece) => SplitSentences.tidy(piece.text) !== "")
    const parts = filled
      .filter((piece) => piece.part)
      .map((piece) => SplitSentences.tidy(piece.text))
    if (filled.length < 2 || parts.length === 0) {
      return undefined
    }
    return { text: SplitSentences.tidy(pieces.map((piece) => piece.text).join("")), parts }
  }

  private static childPieces(children: ts.NodeArray<ts.JsxChild>): Piece[] {
    return children.flatMap((child) => SplitSentences.childPiece(child))
  }

  private static childPiece(child: ts.JsxChild): Piece[] {
    if (ts.isJsxText(child)) {
      return [{ text: child.text, part: true }]
    }
    if (ts.isJsxExpression(child)) {
      return child.expression === undefined ? [] : [SplitSentences.valuePiece(child.expression)]
    }
    if (ts.isJsxSelfClosingElement(child)) {
      return [{ text: VALUE, part: false }]
    }
    if (ts.isJsxElement(child) && SplitSentences.endsTheSentence(child)) {
      return [{ text: SENTENCE_END, part: false }]
    }
    const inner = SplitSentences.childPieces(child.children)
    return [{ text: inner.map((piece) => piece.text).join(""), part: true }]
  }

  private static endsTheSentence(element: ts.JsxElement): boolean {
    const tag = element.openingElement.tagName.getText()
    return /^[a-z]/.test(tag) && !INLINE_TAGS.has(tag)
  }

  private static operandPieces(node: ts.Expression): Piece[] {
    return SplitSentences.isConcatenation(node)
      ? [...SplitSentences.operandPieces(node.left), ...SplitSentences.operandPieces(node.right)]
      : [SplitSentences.valuePiece(node)]
  }

  private static valuePiece(node: ts.Expression): Piece {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { text: node.text, part: true }
    }
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans.map((span) => VALUE + span.literal.text).join("")
      return { text: node.head.text + spans, part: true }
    }
    return { text: VALUE, part: false }
  }

  private static isConcatenation(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  }

  private static tidy(text: string): string {
    return text.replace(/\s+/g, " ").trim()
  }
}
