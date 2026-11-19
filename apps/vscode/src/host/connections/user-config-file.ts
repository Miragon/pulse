import { chmod, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname } from "node:path"
import { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"

const PRIVATE_FILE = 0o600
const PRIVATE_FOLDER = 0o700

export class UserConfigFile {
  static readonly EMPTY = `${JSON.stringify({ profiles: {} }, undefined, 2)}\n`

  static location(): UserConfigLocation {
    return new UserConfigLocation(process.env, homedir(), process.platform)
  }

  static async createIfMissing(path: string): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_FOLDER })
    try {
      await writeFile(path, UserConfigFile.EMPTY, { mode: PRIVATE_FILE, flag: "wx" })
    } catch (error) {
      if (UserConfigFile.exists(error)) {
        return false
      }
      throw error
    }
    await chmod(path, PRIVATE_FILE)
    return true
  }

  private static exists(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST"
  }
}
