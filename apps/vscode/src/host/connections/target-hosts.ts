import type { EngineTarget } from "./engine-target.js"

const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

export class TargetHosts {
  static isLoopback(target: EngineTarget): boolean {
    return TargetHosts.isLoopbackUrl(target.endpoint)
  }

  static isLoopbackUrl(url: string): boolean {
    return LOOPBACK.has(new URL(url).hostname)
  }

  static secretHost(target: EngineTarget): string {
    const { auth } = target
    return new URL(auth.kind === "clientCredentials" ? auth.tokenEndpoint : target.endpoint).host
  }
}
