import type { BoardTile, BoardWidget, RefusedWidget } from "./board-definition.js"
import type { BoardProblem } from "./board-problems.js"
import { BoardVocabulary } from "./board-vocabulary.js"
import { ParseProblems, type Json } from "./parse-problems.js"
import { WidgetParser } from "./widget-parser.js"

export class TileParser {
  private shown = 0

  constructor(private readonly engines: readonly string[]) {}

  parse(value: unknown, path: string): BoardTile {
    const problems = new ParseProblems()
    const widget = new WidgetParser(problems, this.engines).parse(value, path)
    if (widget === undefined || problems.list.length > 0) {
      return TileParser.refusedOf(value, problems.list)
    }
    return this.counted(widget, path)
  }

  private counted(widget: BoardWidget, path: string): BoardTile {
    this.shown += 1
    if (this.shown <= BoardVocabulary.MAX_WIDGETS) {
      return widget
    }
    const values = { position: this.shown, max: BoardVocabulary.MAX_WIDGETS }
    return {
      widget: widget.widget,
      ...(widget.title === undefined ? {} : { title: widget.title }),
      refused: [{ path, code: "tooManyWidgets", values }],
    }
  }

  private static refusedOf(value: unknown, problems: readonly BoardProblem[]): RefusedWidget {
    const record = TileParser.recordOf(value)
    const widget = record.widget
    const title = TileParser.recordOf(record.props).title
    return {
      ...(typeof widget === "string" ? { widget } : {}),
      ...(typeof title === "string" && title.trim() !== "" ? { title } : {}),
      refused: problems,
    }
  }

  private static recordOf(value: unknown): Json {
    return typeof value === "object" && value !== null ? (value as Json) : {}
  }
}
