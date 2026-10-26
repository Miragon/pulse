import { basename, dirname } from "node:path"
import * as vscode from "vscode"

export interface TargetsFileEntry<File> {
  readonly file: File
  readonly fallback: boolean
}

export class TargetsFile {
  static readonly NAME = ".pulse-cli.json"

  static readonly FALLBACK_NAME = ".operate.json"

  static readonly GLOB = `**/{${TargetsFile.NAME},${TargetsFile.FALLBACK_NAME}}`

  static readonly TEMPLATE = `${JSON.stringify(
    { profiles: { local: { url: "http://localhost:8080/engine-rest" } } },
    undefined,
    2,
  )}\n`

  static in(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, TargetsFile.NAME)
  }

  static readingOrder<File extends { readonly fsPath: string }>(
    files: readonly File[],
  ): readonly TargetsFileEntry<File>[] {
    const current = files.filter((file) => basename(file.fsPath) === TargetsFile.NAME)
    const covered = new Set(current.map((file) => dirname(file.fsPath)))
    const fallbacks = files.filter(
      (file) =>
        basename(file.fsPath) === TargetsFile.FALLBACK_NAME && !covered.has(dirname(file.fsPath)),
    )
    return [
      ...current.map((file) => ({ file, fallback: false })),
      ...fallbacks.map((file) => ({ file, fallback: true })),
    ]
  }
}
