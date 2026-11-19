import * as vscode from "vscode"
import type { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import type { ConnectionRegistry } from "./connection-registry.js"
import { TargetsFile } from "./targets-file.js"
import { UserConfigFile } from "./user-config-file.js"

export class ConnectionWatcher implements vscode.Disposable {
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly registry: ConnectionRegistry,
    location: UserConfigLocation = UserConfigFile.location(),
  ) {
    const reload = () => {
      this.reload()
    }
    const own = vscode.Uri.file(location.path).fsPath
    this.subscription = vscode.Disposable.from(
      ...ConnectionWatcher.watchers(location).flatMap((watcher) => [
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

  private static watchers(location: UserConfigLocation): vscode.FileSystemWatcher[] {
    const projectFiles = vscode.workspace.createFileSystemWatcher(TargetsFile.GLOB)
    if (location.isRelative()) {
      return [projectFiles]
    }
    const userConfig = ConnectionWatcher.watcherOf(location.folder(), location.fileName())
    if (location.parentFolder() === location.folder()) {
      return [projectFiles, userConfig]
    }
    const folder = ConnectionWatcher.watcherOf(location.parentFolder(), location.folderName(), true)
    return [projectFiles, userConfig, folder]
  }

  private static watcherOf(
    base: string,
    name: string,
    ignoreChanges = false,
  ): vscode.FileSystemWatcher {
    return vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(base), name),
      false,
      ignoreChanges,
      false,
    )
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
