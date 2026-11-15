import type { BoardDefinition, BoardTile } from "./board-definition.js"
import type { BoardProblem } from "./board-problems.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { ParseProblems, type Json } from "./parse-problems.js"
import { TileParser } from "./tile-parser.js"

export type BoardParse =
  | { readonly board: BoardDefinition; readonly notes: readonly BoardProblem[] }
  | { readonly problems: readonly BoardProblem[] }

export class BoardParser {
  private readonly problems = new ParseProblems()
  private readonly notes = new ParseProblems()

  static parse(content: string): BoardParse {
    return new BoardParser().parseDocument(content)
  }

  private parseDocument(content: string): BoardParse {
    let document: unknown
    try {
      document = JSON.parse(content)
    } catch {
      return { problems: [{ path: "(file)", code: "notJson" }] }
    }
    const board = this.boardOf(document)
    return board === undefined || this.problems.list.length > 0
      ? { problems: this.problems.list }
      : { board, notes: this.notes.list }
  }

  private boardOf(document: unknown): BoardDefinition | undefined {
    const record = this.problems.record(document, "")
    if (record === undefined) {
      return undefined
    }
    this.noteUnknownKeys(record)
    this.checkVersion(record.schemaVersion)
    this.checkRequired(record)
    const title = this.problems.text(record, "title", "")
    const engines = this.problems.names(record, "engines", "")
    const tenants = this.problems.names(record, "tenants", "", "tenantIds")
    if (title === undefined || engines === undefined) {
      return undefined
    }
    const rows = this.rowsOf(record, engines)
    if (rows === undefined) {
      return undefined
    }
    return { title, engines, ...(tenants === undefined ? {} : { tenants }), rows }
  }

  private noteUnknownKeys(record: Json): void {
    for (const key of Object.keys(record)) {
      if (!BoardVocabulary.DOCUMENT_KEYS.includes(key)) {
        this.notes.plain(key, "ignoredKey")
      }
    }
  }

  private checkRequired(record: Json): void {
    for (const key of BoardVocabulary.REQUIRED) {
      if (record[key] === undefined) {
        this.problems.plain(key, "missing")
      }
    }
  }

  private checkVersion(version: unknown): void {
    if (version !== undefined && version !== BoardVocabulary.SCHEMA_VERSION) {
      this.problems.add({
        path: "schemaVersion",
        code: "unknownVersion",
        values: { found: JSON.stringify(version), reads: BoardVocabulary.SCHEMA_VERSION },
      })
    }
  }

  private rowsOf(
    record: Json,
    engines: readonly string[],
  ): readonly (readonly BoardTile[])[] | undefined {
    const rows = record.rows === undefined ? undefined : this.problems.items(record.rows, "rows")
    if (rows === undefined) {
      return undefined
    }
    const tiles = new TileParser(engines)
    return rows.map((row, index) => this.rowOf(row, ParseProblems.index("rows", index), tiles))
  }

  private rowOf(value: unknown, path: string, tiles: TileParser): readonly BoardTile[] {
    const record = this.problems.record(value, path)
    if (record === undefined) {
      return []
    }
    this.problems.onlyKeys(record, BoardVocabulary.ROW_KEYS, path)
    const rowPath = ParseProblems.key(path, "row")
    if (record.row === undefined) {
      this.problems.plain(rowPath, "missing")
      return []
    }
    const entries = this.problems.items(record.row, rowPath) ?? []
    return entries.map((entry, index) => tiles.parse(entry, ParseProblems.index(rowPath, index)))
  }
}
