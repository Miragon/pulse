import { posix, win32 } from "node:path"

type Env = Readonly<Record<string, string | undefined>>

const VARIABLE = "PULSE_CLI_CONFIG"
const FOLDER = "pulse-cli"
const NAME = "config.json"

export class UserConfigLocation {
  static readonly VARIABLE = VARIABLE

  readonly path: string

  readonly explicit: boolean

  private readonly paths: typeof posix

  constructor(env: Env, home: string, platform: string) {
    this.paths = platform === "win32" ? win32 : posix
    const named = UserConfigLocation.given(env[VARIABLE])
    this.explicit = named !== undefined
    this.path =
      named ?? this.paths.join(UserConfigLocation.configHome(env, home, platform), FOLDER, NAME)
  }

  isRelative(): boolean {
    return !this.paths.isAbsolute(this.path)
  }

  folder(): string {
    return this.paths.dirname(this.path)
  }

  fileName(): string {
    return this.paths.basename(this.path)
  }

  parentFolder(): string {
    return this.paths.dirname(this.folder())
  }

  folderName(): string {
    return this.paths.basename(this.folder())
  }

  private static configHome(env: Env, home: string, platform: string): string {
    if (platform === "win32") {
      return (
        UserConfigLocation.absolute(env.APPDATA, win32) ?? win32.join(home, "AppData", "Roaming")
      )
    }
    return UserConfigLocation.absolute(env.XDG_CONFIG_HOME, posix) ?? posix.join(home, ".config")
  }

  private static given(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === "" ? undefined : value
  }

  private static absolute(value: string | undefined, paths: typeof posix): string | undefined {
    return value !== undefined && paths.isAbsolute(value) ? value : undefined
  }
}
