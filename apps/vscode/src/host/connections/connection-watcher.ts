import * as vscode from "vscode"
import type { ConnectionRegistry } from "./connection-registry.js"
import { TargetsFile } from "./targets-file.js"

export class ConnectionWatcher implements vscode.Disposable {
  private readonly subscription: vscode.Disposable

  constructor(private readonly registry: ConnectionRegistry) {
    const watcher = vscode.workspace.createFileSystemWatcher(TargetsFile.GLOB)
    const reload = () => {
      this.reload()
    }
    this.subscription = vscode.Disposable.from(
      watcher,
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      watcher.onDidDelete(reload),
      vscode.workspace.onDidChangeConfiguration((event) => {
        this.configurationChanged(event)
      }),
    )
  }

  dispose(): void {
    this.subscription.dispose()
  }

  private configurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (!event.affectsConfiguration("pulse")) {
      return
    }
    const others = ["pulse.environments", "pulse.writes"].some((setting) =>
      event.affectsConfiguration(setting),
    )
    if (!others && event.affectsConfiguration("pulse.liveUpdates")) {
      this.registry.applyLiveSettings()
      return
    }
    this.reload()
  }

  private reload(): void {
    void this.registry.reload()
  }
}
