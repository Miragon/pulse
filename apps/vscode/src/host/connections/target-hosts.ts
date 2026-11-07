import type { EngineTarget } from "./engine-target.js"

const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

export interface CredentialHosts {
  readonly secret: string
  readonly tokens?: string
}

export class TargetHosts {
  static isLoopback(target: EngineTarget): boolean {
    return TargetHosts.isLoopbackUrl(target.endpoint)
  }

  static isLoopbackUrl(url: string): boolean {
    return LOOPBACK.has(new URL(url).hostname)
  }

  static credentialHosts(target: EngineTarget): CredentialHosts | undefined {
    const { auth } = target
    const endpoint = new URL(target.endpoint).host
    if (auth.kind === "clientCredentials") {
      return { secret: new URL(auth.tokenEndpoint).host, tokens: endpoint }
    }
    return auth.kind === "basic" ? { secret: endpoint } : undefined
  }

  static credentialOrigins(target: EngineTarget): string {
    const endpoint = new URL(target.endpoint).origin
    return target.auth.kind === "clientCredentials"
      ? `${endpoint} and ${new URL(target.auth.tokenEndpoint).origin}`
      : endpoint
  }
}
