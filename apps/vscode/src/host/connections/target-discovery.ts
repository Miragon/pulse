import * as vscode from "vscode"
import {
  type DiscoveredTargets,
  type EngineTarget,
  type FileVerdict,
  TargetMerge,
  type UserConfigLocation,
  UserConfigRead,
  type UserConfigVerdict,
} from "@miragon/pulse-runtime-view/host-kit"
import { TargetsFile } from "./targets-file.js"
import { UserConfigFile } from "./user-config-file.js"

const MISSING = "FileNotFound"

type Failure = Exclude<UserConfigVerdict["kind"], "read">

export class TargetDiscovery {
  private readonly merge: TargetMerge

  constructor(local: EngineTarget) {
    this.merge = new TargetMerge(local)
  }

  async discover(
    location: UserConfigLocation = UserConfigFile.location(),
  ): Promise<DiscoveredTargets> {
    const found = await vscode.workspace.findFiles(TargetsFile.GLOB, "**/node_modules/**")
    const current = await Promise.all(
      TargetsFile.current(found).map((file) =>
        TargetDiscovery.read(file, file.fsPath, () => "unreadable"),
      ),
    )
    const former = TargetsFile.formerOnly(found).map((file): FileVerdict => ({
      kind: "former-name",
      path: file.fsPath,
    }))
    return this.merge.merge([...current, ...former], await TargetDiscovery.userConfig(location))
  }

  private static userConfig(location: UserConfigLocation): Promise<UserConfigRead> {
    return UserConfigRead.of(location, (path) =>
      TargetDiscovery.read(vscode.Uri.file(path), path, (error) =>
        TargetDiscovery.isMissing(error) ? "missing" : "unreadable",
      ),
    )
  }

  private static read(
    file: vscode.Uri,
    path: string,
    failure: (error: unknown) => Failure,
  ): Promise<UserConfigVerdict> {
    return Promise.resolve(vscode.workspace.fs.readFile(file)).then(
      (bytes): UserConfigVerdict => ({
        kind: "read",
        path,
        text: new TextDecoder().decode(bytes),
      }),
      (error: unknown): UserConfigVerdict => ({ kind: failure(error), path }),
    )
  }

  private static isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === MISSING
  }
}
