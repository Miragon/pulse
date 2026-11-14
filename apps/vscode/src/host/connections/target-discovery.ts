import * as vscode from "vscode"
import {
  type DiscoveredTargets,
  type FileVerdict,
  LOCAL_TARGET,
  TargetMerge,
} from "@miragon/pulse-runtime-view/host-kit"
import { TargetsFile } from "./targets-file.js"

export class TargetDiscovery {
  private static readonly MERGE = new TargetMerge(LOCAL_TARGET)

  static async discover(): Promise<DiscoveredTargets> {
    const found = await vscode.workspace.findFiles(TargetsFile.GLOB, "**/node_modules/**")
    const current = await Promise.all(
      TargetsFile.current(found).map((file) => TargetDiscovery.read(file)),
    )
    const former = TargetsFile.formerOnly(found).map((file): FileVerdict => ({
      kind: "former-name",
      path: file.fsPath,
    }))
    return TargetDiscovery.MERGE.merge([...current, ...former])
  }

  private static read(file: vscode.Uri): Promise<FileVerdict> {
    return Promise.resolve(vscode.workspace.fs.readFile(file)).then(
      (bytes): FileVerdict => ({
        kind: "read",
        path: file.fsPath,
        text: new TextDecoder().decode(bytes),
      }),
      (): FileVerdict => ({ kind: "unreadable", path: file.fsPath }),
    )
  }
}
