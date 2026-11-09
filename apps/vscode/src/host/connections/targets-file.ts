import { basename, dirname } from "node:path"
import * as vscode from "vscode"

export class TargetsFile {
  static readonly NAME = ".pulse.json"

  static readonly FORMER_NAME = ".pulse-cli.json"

  static readonly GLOB = `**/{${TargetsFile.NAME},${TargetsFile.FORMER_NAME}}`

  static readonly RENAME = `Pulse reads ${TargetsFile.NAME} now. Rename this file to ${TargetsFile.NAME}; its content stays.`

  static readonly TEMPLATE = `${JSON.stringify(
    { profiles: { local: { url: "http://localhost:8080/engine-rest" } } },
    undefined,
    2,
  )}\n`

  static in(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, TargetsFile.NAME)
  }

  static current<File extends { readonly fsPath: string }>(files: readonly File[]): File[] {
    return files.filter((file) => basename(file.fsPath) === TargetsFile.NAME)
  }

  static formerOnly<File extends { readonly fsPath: string }>(files: readonly File[]): File[] {
    const covered = new Set(TargetsFile.current(files).map((file) => dirname(file.fsPath)))
    return files.filter(
      (file) =>
        basename(file.fsPath) === TargetsFile.FORMER_NAME && !covered.has(dirname(file.fsPath)),
    )
  }
}
