import { basename } from "node:path"

const PROJECT = ".pulse-cli.json"

export class ProfileFileName {
  static readonly PROJECT = PROJECT

  static label(path: string): string {
    return ProfileFileName.isProject(path) ? PROJECT : "CLI config"
  }

  static inSentence(path: string): string {
    return ProfileFileName.isProject(path) ? PROJECT : "your CLI config"
  }

  private static isProject(path: string): boolean {
    return basename(path) === PROJECT
  }
}
