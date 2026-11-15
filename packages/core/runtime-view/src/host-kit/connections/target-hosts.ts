import { isLoopbackHost } from "@miragon/pulse-profile"
import type { EngineTarget } from "./engine-target.js"

const THIS_MACHINE: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

export class TargetHosts {
  static isLoopback(target: EngineTarget): boolean {
    return THIS_MACHINE.has(new URL(target.endpoint).hostname)
  }

  static inClearText(url: string): boolean {
    const { protocol, hostname } = new URL(url)
    return protocol === "http:" && !isLoopbackHost(hostname)
  }

  static credentialOrigins(target: EngineTarget): string {
    const endpoint = new URL(target.endpoint).origin
    return target.auth.kind === "clientCredentials"
      ? `${endpoint} and ${new URL(target.auth.tokenEndpoint).origin}`
      : endpoint
  }

  static sendsTo(target: EngineTarget): string {
    const endpoint = new URL(target.endpoint).host
    return target.auth.kind === "clientCredentials"
      ? `Pulse sends it to ${new URL(target.auth.tokenEndpoint).host} and the tokens it gets to ${endpoint}.`
      : `Pulse sends it to ${endpoint}.`
  }
}
