import { glob, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { WorkspaceFiles } from "../../../src/contract/index.js"

const EXCLUDED = /(^|\/)(node_modules|target|build|dist|dist-orca|out|\.git|\.pulse\/views)(\/|$)/

export class OrcaWorkspaceFiles implements WorkspaceFiles {
  constructor(private readonly roots: () => readonly string[]) {}

  async find(pattern: string, limit: number): Promise<readonly string[]> {
    const found: string[] = []
    for (const root of this.roots()) {
      for await (const file of glob(pattern, {
        cwd: root,
        exclude: (path) => EXCLUDED.test(path),
      })) {
        found.push(pathToFileURL(join(root, file)).toString())
        if (found.length >= limit) {
          return found
        }
      }
    }
    return found
  }

  read(uri: string): Promise<string> {
    return readFile(fileURLToPath(uri), "utf8")
  }

  static pathOf(uri: string): string {
    return fileURLToPath(uri)
  }
}
