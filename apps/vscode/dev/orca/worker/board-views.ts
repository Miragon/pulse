import {
  BoardPanel,
  StatePublisher,
  type BoardEngine,
  type BoardNavigation,
} from "../../../src/core/index.js"
import { MessageGuards } from "../../../src/core/protocol/index.js"
import type { OrcaWorkerApi } from "orca/worker"
import type { FrameAction, ViewSpec } from "../protocol.js"
import type { EngineRegistry } from "./engine-registry.js"

export interface BoardHost {
  open(engine: string, spec: ViewSpec): void
  editEngines(): void
  askForLogin(engine: string): void
}

interface OpenBoard {
  text: string
  readonly panel: BoardPanel
  collector: FrameAction[] | undefined
}

export class BoardViews {
  private readonly boards = new Map<string, OpenBoard>()

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly registry: EngineRegistry,
    private readonly host: BoardHost,
  ) {
    registry.onDidChange(() => {
      for (const board of this.boards.values()) {
        void board.panel.handle({ type: "refresh" })
      }
    })
  }

  attach(frame: string, text: string): void {
    this.closed(frame)
    const publisher = new StatePublisher((message) => {
      this.orca.panels.post("cockpit.state", { message }, { panel: frame })
    })
    const board: OpenBoard = {
      text,
      collector: undefined,
      panel: new BoardPanel({
        fileName: "this board",
        read: () => Promise.resolve(board.text),
        engines: (names) => names.map((name) => this.engineOf(name)),
        navigation: this.navigationFor(frame),
        publish: (state) => {
          publisher.publish(state)
        },
        now: () => new Date(),
      }),
    }
    this.boards.set(frame, board)
  }

  changed(frame: string, text: string): boolean {
    const board = this.boards.get(frame)
    if (board === undefined) {
      return false
    }
    board.text = text
    void board.panel.handle({ type: "refresh" })
    return true
  }

  async intent(
    frame: string,
    intent: unknown,
  ): Promise<{ known: boolean; actions: readonly FrameAction[] }> {
    const board = this.boards.get(frame)
    if (board === undefined) {
      return { known: false, actions: [] }
    }
    if (!MessageGuards.isWebviewIntent(intent) || intent.type === "activity") {
      return { known: true, actions: [] }
    }
    const actions: FrameAction[] = []
    board.collector = actions
    await board.panel.handle(intent)
    board.collector = undefined
    return { known: true, actions }
  }

  dispose(): void {
    for (const frame of [...this.boards.keys()]) {
      this.closed(frame)
    }
  }

  knows(frame: string): boolean {
    return this.boards.has(frame)
  }

  closed(frame: string): void {
    this.boards.get(frame)?.panel.dispose()
    this.boards.delete(frame)
  }

  private engineOf(name: string): BoardEngine {
    const connection = this.registry.byName(name)
    if (connection === undefined) {
      return { name, configured: false }
    }
    return {
      name,
      configured: true,
      badge: connection.badge,
      runtime: connection.runtime,
      definitions: connection.definitions,
    }
  }

  private navigationFor(frame: string): BoardNavigation {
    return {
      openInstance: (engine, instanceId) => {
        this.host.open(engine, { view: "instance", instanceId })
      },
      openDefinition: (engine, bpmnProcessId, filter) => {
        this.host.open(engine, { view: "definition", bpmnProcessId, filter })
      },
      openEngine: (engine) => {
        this.host.open(engine, { view: "engine" })
      },
      openFile: () => {
        this.orca.log("Switch the tab to Source to edit the board file.")
      },
      editEngines: () => {
        this.host.editEngines()
      },
      setCredentials: (engine) => {
        this.host.askForLogin(engine)
      },
      copy: (text, label) => {
        this.boards.get(frame)?.collector?.push({ kind: "copy", text, label })
      },
    }
  }
}
