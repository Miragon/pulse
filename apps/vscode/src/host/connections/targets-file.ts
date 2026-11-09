import * as vscode from "vscode"
import { ProfileFileName } from "./profile-file-name.js"

export class TargetsFile {
  static readonly NAME = ProfileFileName.PROJECT

  static readonly GLOB = `**/${TargetsFile.NAME}`

  static readonly TEMPLATE = `${JSON.stringify(
    { profiles: { local: { url: "http://localhost:8080/engine-rest" } } },
    undefined,
    2,
  )}\n`

  static in(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, TargetsFile.NAME)
  }
}
