import { basename, dirname } from "node:path"

export class ProjectFile {
  static readonly NAME = ".pulse.json"

  static readonly FORMER_NAME = ".pulse-cli.json"

  static readonly RENAME = `Pulse reads ${ProjectFile.NAME} now. Rename this file to ${ProjectFile.NAME}; its content stays.`

  static isCurrent(path: string): boolean {
    return basename(path) === ProjectFile.NAME
  }

  static formerOnly(paths: readonly string[]): string[] {
    const covered = new Set(paths.filter((path) => ProjectFile.isCurrent(path)).map(dirname))
    return paths.filter(
      (path) => basename(path) === ProjectFile.FORMER_NAME && !covered.has(dirname(path)),
    )
  }
}
