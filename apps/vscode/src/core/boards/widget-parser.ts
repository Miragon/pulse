import type { BoardColumn } from "../protocol/index.js"
import type { BoardWidget, BoardWidgetType } from "./board-definition.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { FilterParser } from "./filter-parser.js"
import { ParseProblems, type Json } from "./parse-problems.js"

interface Common {
  readonly title?: string
  readonly engines: readonly string[]
}

export class WidgetParser {
  private readonly filters: FilterParser

  constructor(
    private readonly problems: ParseProblems,
    private readonly boardEngines: readonly string[],
  ) {
    this.filters = new FilterParser(problems)
  }

  parse(value: unknown, path: string): BoardWidget | undefined {
    const record = this.problems.record(value, path)
    if (record === undefined) {
      return undefined
    }
    this.problems.onlyKeys(record, BoardVocabulary.WIDGET_KEYS, path)
    const type = this.typeOf(record, path)
    const propsPath = ParseProblems.key(path, "props")
    const props = record.props === undefined ? {} : this.problems.record(record.props, propsPath)
    if (type === undefined || props === undefined) {
      return undefined
    }
    this.problems.onlyKeys(props, BoardVocabulary.PROPS[type], propsPath)
    return this.widgetOf(type, props, propsPath)
  }

  private typeOf(record: Json, path: string): BoardWidgetType | undefined {
    if (record.widget === undefined) {
      this.problems.add(ParseProblems.key(path, "widget"), "is missing")
      return undefined
    }
    return this.problems.oneOf(record, "widget", BoardVocabulary.WIDGETS, path)
  }

  private widgetOf(type: BoardWidgetType, props: Json, path: string): BoardWidget | undefined {
    const before = this.problems.list.length
    const common = this.commonOf(props, path)
    const widget = this.specificOf(type, props, path, common)
    return this.problems.list.length > before ? undefined : widget
  }

  private specificOf(
    type: BoardWidgetType,
    props: Json,
    path: string,
    common: Common,
  ): BoardWidget | undefined {
    if (type === "incidentSummary") {
      const groupBy = this.problems.oneOf(props, "groupBy", BoardVocabulary.GROUPINGS, path)
      return { widget: type, ...common, groupBy: groupBy ?? "process" }
    }
    const filter = this.filters.parse(props.filter, ParseProblems.key(path, "filter"))
    if (filter === undefined) {
      return undefined
    }
    if (type === "counter") {
      const warnAbove = this.warnAboveOf(props.warnAbove, ParseProblems.key(path, "warnAbove"))
      return { widget: type, ...common, filter, ...(warnAbove === undefined ? {} : { warnAbove }) }
    }
    const columns = this.columnsOf(props.columns, ParseProblems.key(path, "columns"))
    return { widget: type, ...common, filter, columns }
  }

  private commonOf(props: Json, path: string): Common {
    const title = this.problems.text(props, "title", path)
    const engines = this.problems.names(props, "engines", path) ?? this.boardEngines
    const outside = engines.filter((name) => !this.boardEngines.includes(name))
    if (outside.length > 0) {
      this.problems.add(
        ParseProblems.key(path, "engines"),
        `may only name engines of the board; ${outside.join(", ")} is not in its engines`,
      )
    }
    return { engines, ...(title === undefined ? {} : { title }) }
  }

  private warnAboveOf(value: unknown, path: string): number | undefined {
    if (value === undefined) {
      return undefined
    }
    const valid = typeof value === "number" && Number.isInteger(value) && value >= 0
    return this.problems.checked(
      valid,
      value as number,
      path,
      "must be a whole number of 0 or more",
    )
  }

  private columnsOf(value: unknown, path: string): readonly BoardColumn[] {
    if (value === undefined) {
      return BoardVocabulary.DEFAULT_COLUMNS
    }
    const columns = this.problems.items(value, path) ?? []
    columns.forEach((column, index) => {
      this.checkColumn(column, ParseProblems.index(path, index))
    })
    return columns as BoardColumn[]
  }

  private checkColumn(column: unknown, path: string): void {
    if (typeof column === "string" && column.startsWith("var:")) {
      this.problems.add(path, "variable columns are not supported yet")
      return
    }
    if (!BoardVocabulary.COLUMNS.includes(column as BoardColumn)) {
      this.problems.add(path, `must be one of ${BoardVocabulary.COLUMNS.join(", ")}`)
    }
  }
}
