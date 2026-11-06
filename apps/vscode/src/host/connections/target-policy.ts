import type { Credentials } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export class TargetPolicy {
  static refusal(target: EngineTarget, credentials: Credentials): string | undefined {
    const { auth } = target
    if (auth.kind === "oauth2") {
      return `${target.name} uses OAuth2 with a browser login, which Pulse does not support yet.`
    }
    if (auth.kind === "none") {
      return undefined
    }
    if (credentials.kind === "savedForAnotherEndpoint") {
      return `The endpoint of ${target.name} changed since its credentials were saved for ${credentials.savedFor}. Set the credentials again to send them to the new endpoint.`
    }
    if (TargetPolicy.sendsSecretsInClearText(target)) {
      return `${target.name} would send its credentials over plain HTTP. Use an https endpoint.`
    }
    return undefined
  }

  private static sendsSecretsInClearText(target: EngineTarget): boolean {
    const urls =
      target.auth.kind === "clientCredentials"
        ? [target.endpoint, target.auth.tokenEndpoint]
        : [target.endpoint]
    return urls.some((url) => new URL(url).protocol === "http:" && !TargetHosts.isLoopbackUrl(url))
  }
}
