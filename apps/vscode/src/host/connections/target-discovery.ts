import * as vscode from "vscode"
import { TargetMerge, type DiscoveredTargets } from "./target-merge.js"
import { TargetsFile } from "./targets-file.js"
import { TargetsParser, type ParsedTargets } from "./targets-parser.js"
import { TargetsProblem } from "./targets-problem.js"
import { UserConfigFile, type UserConfigLocation } from "./user-config-file.js"

const MISSING = "FileNotFound"

export class TargetDiscovery {
  static async discover(
    user: UserConfigLocation = UserConfigFile.current(),
  ): Promise<DiscoveredTargets> {
    const found = await vscode.workspace.findFiles(TargetsFile.GLOB, "**/node_modules/**")
    const own = await TargetDiscovery.ownFile(user)
    if (!user.explicit) {
      return TargetMerge.of(
        await Promise.all(found.map((file) => TargetDiscovery.projectFile(file))),
        own,
      )
    }
    const skipped = found.length === 0 ? [] : [TargetDiscovery.skipped(user)]
    return TargetMerge.of([], { ...own, problems: [...own.problems, ...skipped] })
  }

  private static async projectFile(file: vscode.Uri): Promise<ParsedTargets> {
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
    return new TargetsParser(file.fsPath).parse(content)
  }

  private static async ownFile(user: UserConfigLocation): Promise<ParsedTargets> {
    const read = await vscode.workspace.fs.readFile(vscode.Uri.file(user.path)).then(
      (bytes) => new TextDecoder().decode(bytes),
      (error: unknown) => ({ missing: TargetDiscovery.isMissing(error) }),
    )
    if (typeof read === "string") {
      return new TargetsParser(user.path).parse(read)
    }
    const problem = read.missing
      ? `${UserConfigFile.VARIABLE} names this file, which does not exist: create it or change the variable`
      : "the file can't be read"
    const problems = read.missing && !user.explicit ? [] : [new TargetsProblem(user.path, problem)]
    return { names: [], targets: [], problems }
  }

  private static skipped(user: UserConfigLocation): TargetsProblem {
    return new TargetsProblem(
      user.path,
      `${UserConfigFile.VARIABLE} names this file, so Pulse reads no ${TargetsFile.NAME}, like the CLI`,
      "warning",
    )
  }

  private static isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === MISSING
  }
}
