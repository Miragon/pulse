import { BoardParser, type BoardDefinition } from "@miragon/pulse-board"
import { BoardBuilder } from "@miragon/pulse-board/builder"
import { BpmnProcessId, InstanceId } from "@miragon/pulse-engine-core"
import type { Panel } from "../panels/panel.js"
import type { BoardView, WebviewIntent } from "../protocol/index.js"
import type { BoardContext } from "./board-engine.js"
import { BoardTargets } from "./board-targets.js"
import { BoardViews, type BoardSource } from "./board-views.js"

export class BoardPanel implements Panel {
  private board: BoardDefinition | undefined
  private view: BoardView | undefined
  private latest = 0
  private closed = false

  constructor(private readonly context: BoardContext) {}

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case "ready":
        if (this.view === undefined) {
          return this.load()
        }
        this.publish(false)
        return
      case "refresh":
        return this.load()
      case "openBoardFile":
        this.context.navigation.openFile()
        return
      case "editConnection":
        this.context.navigation.editEngines()
        return
      case "copy":
        this.context.navigation.copy(intent.text, intent.label)
        return
      default:
        this.navigate(intent)
        return
    }
  }

  attend(): void {
    return undefined
  }

  nudge(): void {
    return undefined
  }

  dispose(): void {
    this.closed = true
  }

  private async load(): Promise<void> {
    this.latest += 1
    const ticket = this.latest
    if (this.view !== undefined) {
      this.publish(true)
    }
    const view = await this.read(ticket)
    if (ticket === this.latest) {
      this.view = view
      this.publish(false)
    }
  }

  private async read(ticket: number): Promise<BoardView> {
    const asOf = this.context.now()
    const fileName = this.context.fileName
    let content: string
    try {
      content = await this.context.read()
    } catch {
      const problems = [{ path: "(file)", reason: "could not be read" }]
      return this.fallback({ fileName, asOf, problems })
    }
    const parsed = BoardParser.parse(content)
    if ("problems" in parsed) {
      return this.fallback({ fileName, asOf, problems: parsed.problems })
    }
    if (ticket === this.latest) {
      this.board = parsed.board
    }
    return this.build(parsed.board, { fileName, asOf, problems: [] })
  }

  private async fallback(source: BoardSource): Promise<BoardView> {
    const board = this.board
    if (board === undefined) {
      return BoardViews.unreadable(source)
    }
    return this.build(board, source)
  }

  private async build(board: BoardDefinition, source: BoardSource): Promise<BoardView> {
    const views = new BoardViews(this.context.engines(board.engines))
    const model = await BoardBuilder.build(board, views.sources())
    return views.of(model, source)
  }

  private publish(refreshing: boolean): void {
    if (this.view !== undefined && !this.closed) {
      this.context.publish({ status: "ready", view: this.view, refreshing })
    }
  }

  private navigate(intent: WebviewIntent): void {
    if (this.view === undefined) {
      return
    }
    const targets = new BoardTargets(this.view)
    const navigation = this.context.navigation
    switch (intent.type) {
      case "openBoardInstance":
        if (targets.showsInstance(intent.engine, intent.instanceId)) {
          navigation.openInstance(intent.engine, InstanceId(intent.instanceId), {
            toSide: intent.toSide,
          })
        }
        return
      case "openBoardProcess":
        if (targets.showsProcess(intent.engine, intent.bpmnProcessId, intent.filter)) {
          const process = BpmnProcessId(intent.bpmnProcessId)
          navigation.openDefinition(intent.engine, process, intent.filter, {
            toSide: intent.toSide,
          })
        }
        return
      default:
        this.reach(intent, targets)
    }
  }

  private reach(intent: WebviewIntent, targets: BoardTargets): void {
    if (intent.type === "openBoardEngine" && targets.reaches(intent.engine)) {
      this.context.navigation.openEngine(intent.engine, { toSide: intent.toSide })
    } else if (intent.type === "setBoardCredentials" && targets.configures(intent.engine)) {
      this.context.navigation.setCredentials(intent.engine)
    }
  }
}
