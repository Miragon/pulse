import type { BoardContext, BoardEngine, BoardNavigation, OpenOptions } from "../../core/index.js"
import type { PanelState } from "../../core/protocol/index.js"
import * as vscode from "vscode"
import { COMMAND } from "../commands/command-ids.js"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { PanelManager } from "../panels/panel-manager.js"
import { BoardFiles } from "./board-files.js"
import { OpenBoard } from "./open-board.js"

export class BoardPanels implements vscode.Disposable {
  private readonly boards = new Map<string, OpenBoard>()
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly panels: PanelManager,
  ) {
    this.subscription = registry.onDidChange(() => {
      for (const board of this.boards.values()) {
        board.reload()
      }
    })
  }

  open(file: vscode.Uri): void {
    const key = file.toString()
    const existing = this.boards.get(key)
    if (existing !== undefined) {
      existing.panel.reveal()
      return
    }
    const panel = this.panels.createWebview(BoardFiles.nameOf(file), vscode.ViewColumn.Active)
    const board = new OpenBoard(panel, (publish) => this.contextFor(file, publish))
    panel.onDidDispose(() => {
      this.boards.delete(key)
      board.dispose()
    })
    this.boards.set(key, board)
  }

  changed(file: vscode.Uri): void {
    this.boards.get(file.toString())?.reload()
  }

  dispose(): void {
    this.subscription.dispose()
    for (const board of this.boards.values()) {
      board.panel.dispose()
    }
  }

  private contextFor(file: vscode.Uri, publish: (state: PanelState) => void): BoardContext {
    return {
      fileName: BoardFiles.nameOf(file),
      read: () => BoardFiles.read(file),
      engines: (names) => names.map((name) => this.engineOf(name)),
      navigation: this.navigationFor(file),
      publish,
      now: () => new Date(),
    }
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

  private navigationFor(file: vscode.Uri): BoardNavigation {
    const on = (engine: string, run: (connection: Connection) => void): void => {
      const connection = this.registry.byName(engine)
      if (connection !== undefined) {
        run(connection)
      }
    }
    return {
      openInstance: (engine, instanceId, options) => {
        on(engine, (connection) => {
          this.panels.openInstance(connection, instanceId, this.columnFor(options))
        })
      },
      openDefinition: (engine, bpmnProcessId, filter, options) => {
        on(engine, (connection) => {
          this.panels.openDefinition(connection, { bpmnProcessId, filter }, this.columnFor(options))
        })
      },
      openEngine: (engine, options) => {
        on(engine, (connection) => {
          this.panels.openEngine(connection, this.columnFor(options))
        })
      },
      openFile: () => {
        void vscode.window.showTextDocument(file, { viewColumn: vscode.ViewColumn.Beside })
      },
      editEngines: () => {
        void vscode.commands.executeCommand(COMMAND.openTargetsFile)
      },
      setCredentials: (engine) => {
        on(engine, (connection) => {
          void vscode.commands.executeCommand(COMMAND.setCredentials, { connection })
        })
      },
      copy: (text, label) => {
        void vscode.env.clipboard.writeText(text)
        vscode.window.setStatusBarMessage(`$(check) Copied ${label}`, 2000)
      },
    }
  }

  private columnFor(options: OpenOptions): vscode.ViewColumn {
    return options.toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
  }
}
