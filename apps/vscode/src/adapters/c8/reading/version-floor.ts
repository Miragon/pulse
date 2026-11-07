import { RuntimeError } from "../../../contract/index.js"
import type { CamundaClient } from "../rest/index.js"

const VERSION = /^(\d+)\.(\d+)/
const FLOOR_MAJOR = 8
const FLOOR_MINOR = 9

export class VersionFloor {
  private version: Promise<string> | undefined

  constructor(private readonly client: CamundaClient) {}

  checked(): Promise<string> {
    this.version ??= this.read().catch((error: unknown) => {
      this.version = undefined
      throw error
    })
    return this.version
  }

  private async read(): Promise<string> {
    const { gatewayVersion } = await this.client.topology()
    if (VersionFloor.below(gatewayVersion)) {
      throw new RuntimeError(
        "misconfigured",
        `Pulse reads Camunda ${String(FLOOR_MAJOR)}.${String(FLOOR_MINOR)} or newer. This cluster runs ${gatewayVersion}.`,
      )
    }
    return gatewayVersion
  }

  private static below(version: string): boolean {
    const match = VERSION.exec(version)
    if (match === null) {
      return false
    }
    const [major, minor] = [Number(match[1]), Number(match[2])]
    return major < FLOOR_MAJOR || (major === FLOOR_MAJOR && minor < FLOOR_MINOR)
  }
}
