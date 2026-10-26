import type { BoardProblem } from "../protocol/index.js"
import type { BoardDefinition, BoardWidget } from "./board-definition.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { ParseProblems, type Json } from "./parse-problems.js"
import { WidgetParser } from "./widget-parser.js"

export type BoardParse =
  { readonly board: BoardDefinition } | { readonly problems: readonly BoardProblem[] }

export class BoardParser {
  private readonly problems = new ParseProblems()

  static parse(content: string): BoardParse {
    return new BoardParser().parseDocument(content)
  }

  private parseDocument(content: string): BoardParse {
    let document: unknown
    try {
      document = JSON.parse(content)
    } catch {
      return { problems: [{ path: "(file)", reason: "is not valid JSON" }] }
    }
    const board = this.boardOf(document)
    return board === undefined || this.problems.list.length > 0
      ? { problems: this.problems.list }
      : { board }
  }

  private boardOf(document: unknown): BoardDefinition | undefined {
    const record = this.problems.record(document, "")
    if (record === undefined) {
      return undefined
    }
    this.problems.onlyKeys(record, BoardVocabulary.DOCUMENT_KEYS, "")
    this.checkVersion(record.schemaVersion)
    this.checkRequired(record)
    const title = this.problems.text(record, "title", "")
    const engines = this.problems.names(record, "engines", "")
    if (title === undefined || engines === undefined) {
      return undefined
    }
    const rows = this.rowsOf(record, engines)
    return rows === undefined ? undefined : { title, engines, rows }
  }

  private checkRequired(record: Json): void {
    for (const key of ["title", "engines", "rows"]) {
      if (record[key] === undefined) {
        this.problems.add(key, "is missing")
      }
    }
  }

  private checkVersion(version: unknown): void {
    if (version !== undefined && version !== BoardVocabulary.SCHEMA_VERSION) {
      this.problems.add(
        "schemaVersion",
        `is ${JSON.stringify(version)}; this version of Pulse reads version ${BoardVocabulary.SCHEMA_VERSION}`,
      )
    }
  }

  private rowsOf(
    record: Json,
    engines: readonly string[],
  ): readonly (readonly BoardWidget[])[] | undefined {
    const rows = record.rows === undefined ? undefined : this.problems.items(record.rows, "rows")
    if (rows === undefined) {
      return undefined
    }
    const widgets = new WidgetParser(this.problems, engines)
    const parsed = rows.map((row, index) =>
      this.rowOf(row, ParseProblems.index("rows", index), widgets),
    )
    this.checkSize(parsed)
    return parsed
  }

  private rowOf(value: unknown, path: string, widgets: WidgetParser): readonly BoardWidget[] {
    const record = this.problems.record(value, path)
    if (record === undefined) {
      return []
    }
    this.problems.onlyKeys(record, BoardVocabulary.ROW_KEYS, path)
    const rowPath = ParseProblems.key(path, "row")
    if (record.row === undefined) {
      this.problems.add(rowPath, "is missing")
      return []
    }
    const entries = this.problems.items(record.row, rowPath) ?? []
    return entries.flatMap((entry, index) => {
      const widget = widgets.parse(entry, ParseProblems.index(rowPath, index))
      return widget === undefined ? [] : [widget]
    })
  }

  private checkSize(rows: readonly (readonly BoardWidget[])[]): void {
    const count = rows.reduce((sum, row) => sum + row.length, 0)
    if (count > BoardVocabulary.MAX_WIDGETS) {
      this.problems.add(
        "rows",
        `hold ${count} widgets; a board shows at most ${BoardVocabulary.MAX_WIDGETS}, so it stays cheap for the engines`,
      )
    }
  }
}
