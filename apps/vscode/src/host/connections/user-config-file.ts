import { chmod, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, posix, resolve, win32 } from "node:path"

type Env = Readonly<Record<string, string | undefined>>

export interface UserConfigLocation {
  readonly path: string
  readonly explicit: boolean
}

const VARIABLE = "PULSE_CLI_CONFIG"
const DIRECTORY = "pulse-cli"
const NAME = "config.json"
const PRIVATE = 0o600

export class UserConfigFile {
  static readonly VARIABLE = VARIABLE

  static readonly EMPTY = `${JSON.stringify({ profiles: {} }, undefined, 2)}\n`

  static current(): UserConfigLocation {
    return UserConfigFile.locate(process.env, homedir(), process.platform)
  }

  static locate(env: Env, home: string, platform: string): UserConfigLocation {
    const named = env[VARIABLE]
    if (named !== undefined && named.trim() !== "") {
      return { path: resolve(named), explicit: true }
    }
    return { path: UserConfigFile.defaultPath(env, home, platform), explicit: false }
  }

  static async createIfMissing(path: string): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, UserConfigFile.EMPTY, { mode: PRIVATE, flag: "wx" })
    } catch (error) {
      if (UserConfigFile.exists(error)) {
        return false
      }
      throw error
    }
    await chmod(path, PRIVATE)
    return true
  }

  private static defaultPath(env: Env, home: string, platform: string): string {
    if (platform === "win32") {
      const appData =
        UserConfigFile.absolute(env.APPDATA, win32) ?? win32.join(home, "AppData", "Roaming")
      return win32.join(appData, DIRECTORY, NAME)
    }
    const configHome =
      UserConfigFile.absolute(env.XDG_CONFIG_HOME, posix) ?? posix.join(home, ".config")
    return posix.join(configHome, DIRECTORY, NAME)
  }

  private static exists(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"
  }

  private static absolute(value: string | undefined, path: typeof posix): string | undefined {
    return value !== undefined && path.isAbsolute(value) ? value : undefined
  }
}
