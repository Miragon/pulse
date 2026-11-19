import { homedir } from "node:os"
import { basename, sep } from "node:path"
import * as vscode from "vscode"
import type { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import { TargetsFile } from "../connections/targets-file.js"

export interface ProfileHome {
  readonly scope: "known" | "project" | "user"
  readonly file: vscode.Uri
}

interface HomeItem extends vscode.QuickPickItem {
  readonly home: ProfileHome
}

export class ProfileFileChoice {
  static async pick(
    known: readonly string[],
    location: UserConfigLocation,
  ): Promise<ProfileHome | undefined> {
    const own: ProfileHome = { scope: "user", file: vscode.Uri.file(location.path) }
    const folders = location.explicit ? [] : (vscode.workspace.workspaceFolders ?? [])
    if (folders.length === 0) {
      return own
    }
    const several = folders.length > 1
    const items: HomeItem[] = [
      ...folders.map((folder) => ProfileFileChoice.projectItem(folder, several, known)),
      {
        label: "All projects",
        description: ProfileFileChoice.shortened(location.path),
        detail: "Your CLI config: every VS Code window and the CLI read it",
        home: own,
      },
    ]
    const chosen = await vscode.window.showQuickPick(items, {
      title: "Configure Engines",
      placeHolder: "Which file gets your engines?",
    })
    return chosen?.home
  }

  private static projectItem(
    folder: vscode.WorkspaceFolder,
    several: boolean,
    known: readonly string[],
  ): HomeItem {
    const existing = ProfileFileChoice.projectFileIn(folder, known)
    const file = existing === undefined ? TargetsFile.in(folder.uri) : vscode.Uri.file(existing)
    return {
      label: several ? folder.name : "This project",
      description: vscode.workspace.asRelativePath(file, several),
      detail: "Shared with your team through the repository",
      home: { scope: "project", file },
    }
  }

  private static projectFileIn(
    folder: vscode.WorkspaceFolder,
    known: readonly string[],
  ): string | undefined {
    const inFolder = known.filter((path) => path.startsWith(`${folder.uri.fsPath}${sep}`))
    return (
      inFolder.find((path) => basename(path) === TargetsFile.NAME) ??
      inFolder.find((path) => basename(path) === TargetsFile.FORMER_NAME)
    )
  }

  private static shortened(path: string): string {
    const home = homedir()
    return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
  }
}
