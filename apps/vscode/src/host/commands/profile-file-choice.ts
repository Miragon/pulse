import { homedir } from "node:os"
import { basename, sep } from "node:path"
import * as vscode from "vscode"
import { TargetsFile } from "../connections/targets-file.js"
import { UserConfigFile } from "../connections/user-config-file.js"

export interface ProfileHome {
  readonly scope: "project" | "user"
  readonly file: vscode.Uri
}

interface HomeItem extends vscode.QuickPickItem {
  readonly home: ProfileHome
}

export class ProfileFileChoice {
  static async pick(knownProjectFiles: readonly string[]): Promise<ProfileHome | undefined> {
    const user = UserConfigFile.current()
    const own: ProfileHome = { scope: "user", file: vscode.Uri.file(user.path) }
    const folders = user.explicit ? [] : (vscode.workspace.workspaceFolders ?? [])
    if (folders.length === 0) {
      return own
    }
    const items: HomeItem[] = [
      ...folders.map((folder) =>
        ProfileFileChoice.projectItem(folder, folders.length > 1, knownProjectFiles),
      ),
      {
        label: "All projects",
        description: ProfileFileChoice.shortened(user.path),
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
    const inFolder = known.find(
      (path) =>
        basename(path) === TargetsFile.NAME && path.startsWith(`${folder.uri.fsPath}${sep}`),
    )
    const file = inFolder === undefined ? TargetsFile.in(folder.uri) : vscode.Uri.file(inFolder)
    return {
      label: several ? folder.name : "This project",
      description: vscode.workspace.asRelativePath(file, several),
      detail: "Shared with your team through the repository",
      home: { scope: "project", file },
    }
  }

  private static shortened(path: string): string {
    const home = homedir()
    return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
  }
}
