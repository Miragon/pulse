import type { Credentials } from "./connection.js"
import type { EngineTarget, TargetAuth } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export class TargetPolicy {
  static connectsWith(auth: TargetAuth): boolean {
    return auth.kind !== "oauth2"
  }

  static refusal(target: EngineTarget, credentials: Credentials): string | undefined {
    if (!TargetPolicy.connectsWith(target.auth)) {
      return `${target.name} uses OAuth2. This client connects with basic authentication or none; OAuth2 follows.`
    }
    if (target.auth.kind === "basic" && credentials.kind === "savedForAnotherEndpoint") {
      return `The endpoint of ${target.name} changed since its credentials were saved for ${credentials.savedFor}. Set the credentials again to send them to the new endpoint.`
    }
    if (target.auth.kind === "basic" && TargetPolicy.sendsSecretsInClearText(target)) {
      return `${target.name} would send basic credentials over plain HTTP. Use an https endpoint.`
    }
    return undefined
  }

  private static sendsSecretsInClearText(target: EngineTarget): boolean {
    return new URL(target.endpoint).protocol === "http:" && !TargetHosts.isLoopback(target)
  }
}
