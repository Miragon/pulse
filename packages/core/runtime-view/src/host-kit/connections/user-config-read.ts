import type { UserConfigVerdict } from "./file-verdict.js"
import type { UserConfigLocation } from "./user-config-location.js"

export class UserConfigRead {
  private constructor(
    readonly location: UserConfigLocation,
    private readonly answer?: UserConfigVerdict,
  ) {}

  static async of(
    location: UserConfigLocation,
    read: (path: string) => Promise<UserConfigVerdict>,
  ): Promise<UserConfigRead> {
    return location.isRelative()
      ? new UserConfigRead(location)
      : new UserConfigRead(location, await read(location.path))
  }

  verdict(): UserConfigVerdict | undefined {
    return this.answer
  }
}
