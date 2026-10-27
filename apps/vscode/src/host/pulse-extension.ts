import * as vscode from "vscode"
import type { Command } from "./commands/command.js"
import { CommandRegistrar } from "./commands/command-registrar.js"
import { ConnectionEditor } from "./commands/connection-editor.js"
import { ConnectionPicker } from "./commands/connection-picker.js"
import { GoToInstanceCommand } from "./commands/go-to-instance-command.js"
import { OpenDefinitionCommand } from "./commands/open-definition-command.js"
import { OpenEngineOverviewCommand } from "./commands/open-engine-overview-command.js"
import { OpenInstanceCommand } from "./commands/open-instance-command.js"
import { OpenTargetsFileCommand } from "./commands/open-targets-file-command.js"
import { RefreshCommand } from "./commands/refresh-command.js"
import { SetCredentialsCommand } from "./commands/set-credentials-command.js"
import { ShowRuntimeDataCommand } from "./commands/show-runtime-data-command.js"
import { SwitchEngineCommand } from "./commands/switch-engine-command.js"
import { BoardPanels } from "./boards/board-panels.js"
import { BoardWatcher } from "./boards/board-watcher.js"
import { BoardsTree } from "./boards/boards-tree.js"
import { NewBoardCommand } from "./commands/new-board-command.js"
import { OpenBoardCommand } from "./commands/open-board-command.js"
import { CompositionRoot } from "./composition-root.js"
import { ConnectionBuilder } from "./connections/connection-builder.js"
import { ConnectionRegistry } from "./connections/connection-registry.js"
import { ConnectionWatcher } from "./connections/connection-watcher.js"
import { CredentialStore } from "./connections/credential-store.js"
import { WriteAudit } from "./connections/write-audit.js"
import { EngineStatusBar } from "./engine-status-bar.js"
import { EnginesTree } from "./explorer/engines-tree.js"
import { EnginesTreeLive } from "./explorer/engines-tree-live.js"
import { IncidentDecorations } from "./explorer/incident-decorations.js"
import { LiveTriggers } from "./live/live-triggers.js"
import { LiveWiring } from "./live/live-wiring.js"
import { WindowAttention } from "./live/window-attention.js"
import { INCIDENT_SCHEME, IncidentDocuments } from "./panels/incident-documents.js"
import { PanelManager } from "./panels/panel-manager.js"
import { SourceNavigation } from "./panels/source-navigation.js"
import { StackFrameLinks } from "./panels/stack-frame-links.js"
import { WriteConfirmation } from "./panels/write-confirmation.js"
import { VsCodeWorkspaceFiles } from "./workspace/vscode-workspace-files.js"

export class PulseExtension {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    const log = vscode.window.createOutputChannel("Pulse", { log: true })
    const audit = new WriteAudit(log)
    const credentials = new CredentialStore(this.context.secrets)
    const registry = new ConnectionRegistry(
      this.context.workspaceState,
      credentials,
      new ConnectionBuilder(await this.engines(), audit),
    )
    const picker = new ConnectionPicker(registry)
    const setCredentials = new SetCredentialsCommand(registry, credentials, picker)
    const openTargetsFile = new OpenTargetsFileCommand(registry)
    const documents = new IncidentDocuments()
    const sources = CompositionRoot.localSources(new VsCodeWorkspaceFiles())
    const attention = new WindowAttention()
    const live = new LiveWiring(attention, (line) => {
      log.info(line)
    })
    const panels = new PanelManager(
      this.context.extensionUri,
      {
        registry,
        documents,
        editor: new ConnectionEditor(setCredentials, openTargetsFile),
        confirmation: new WriteConfirmation(audit),
        audit,
        navigation: new SourceNavigation(),
        sources,
      },
      live,
    )
    this.context.subscriptions.push(
      log,
      attention,
      registry,
      panels,
      ...this.views(registry, documents, panels, live),
      ...this.boards(registry, panels),
      vscode.languages.registerDocumentLinkProvider(
        { scheme: INCIDENT_SCHEME },
        new StackFrameLinks(sources.code),
      ),
      new ConnectionWatcher(registry),
      CommandRegistrar.register([
        new RefreshCommand(registry),
        new SwitchEngineCommand(registry, picker),
        setCredentials,
        openTargetsFile,
        new OpenEngineOverviewCommand(registry, picker, panels),
        ...this.navigation(registry, panels),
      ]),
    )
    await registry.reload()
  }

  private engines(): Promise<CompositionRoot> {
    return CompositionRoot.create({
      extensionPath: this.context.extensionUri.fsPath,
      storagePath: this.context.globalStorageUri.fsPath,
    })
  }

  private views(
    registry: ConnectionRegistry,
    documents: IncidentDocuments,
    panels: PanelManager,
    live: LiveWiring,
  ): vscode.Disposable[] {
    const engines = new EnginesTree(registry)
    const enginesLive = new EnginesTreeLive(registry, engines, live)
    return [
      engines,
      enginesLive,
      new LiveTriggers(registry, [panels, enginesLive]),
      panels.onDidActivate((focus) => {
        void engines.reveal(focus).catch(() => undefined)
      }),
      new EngineStatusBar(registry),
      vscode.window.registerFileDecorationProvider(new IncidentDecorations()),
      vscode.workspace.registerTextDocumentContentProvider(INCIDENT_SCHEME, documents),
    ]
  }

  private boards(registry: ConnectionRegistry, panels: PanelManager): vscode.Disposable[] {
    const tree = new BoardsTree()
    const boards = new BoardPanels(registry, panels)
    return [
      tree,
      boards,
      new BoardWatcher(tree, boards),
      CommandRegistrar.register([
        new OpenBoardCommand(boards),
        new NewBoardCommand(registry, boards),
      ]),
    ]
  }

  private navigation(registry: ConnectionRegistry, panels: PanelManager): Command[] {
    return [
      new OpenDefinitionCommand(registry, panels),
      new OpenInstanceCommand(registry, panels),
      new GoToInstanceCommand(registry, panels),
      new ShowRuntimeDataCommand(registry, panels),
    ]
  }
}
