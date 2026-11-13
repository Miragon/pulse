import { ProjectFile } from "@miragon/pulse-runtime-view/host-kit"
import * as vscode from "vscode"

export class TargetsFile {
  static readonly NAME = ProjectFile.NAME

  static readonly FORMER_NAME = ProjectFile.FORMER_NAME

  static readonly GLOB = `**/{${TargetsFile.NAME},${TargetsFile.FORMER_NAME}}`

  static readonly RENAME = ProjectFile.RENAME

  static readonly TEMPLATE = `${JSON.stringify(
    { profiles: { local: { url: "http://localhost:8080/engine-rest" } } },
    undefined,
    2,
  )}\n`

  static in(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, TargetsFile.NAME)
  }

  static current<File extends { readonly fsPath: string }>(files: readonly File[]): File[] {
    return files.filter((file) => ProjectFile.isCurrent(file.fsPath))
  }

  static formerOnly<File extends { readonly fsPath: string }>(files: readonly File[]): File[] {
    const former = new Set(ProjectFile.formerOnly(files.map((file) => file.fsPath)))
    return files.filter((file) => former.has(file.fsPath))
  }
}
