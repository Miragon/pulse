import { basename, dirname } from "node:path"
import * as vscode from "vscode"
import type { ConnectionRegistry } from "./connection-registry.js"
import { TargetsFile } from "./targets-file.js"
import { UserConfigFile } from "./user-config-file.js"

export class ConnectionWatcher implements vscode.Disposable {
  private readonly subscription: vscode.Disposable

  constructor(private readonly registry: ConnectionRegistry) {
    const own = UserConfigFile.current().path
    const watchers = [
      vscode.workspace.createFileSystemWatcher(TargetsFile.GLOB),
      vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(dirname(own)), basename(own)),
      ),
    ]
    const reload = () => {
      this.reload()
    }
    this.subscription = vscode.Disposable.from(
      ...watchers.flatMap((watcher) => [
        watcher,
        watcher.onDidChange(reload),
        watcher.onDidCreate(reload),
        watcher.onDidDelete(reload),
      ]),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.fsPath === own) {
          reload()
        }
      }),
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
