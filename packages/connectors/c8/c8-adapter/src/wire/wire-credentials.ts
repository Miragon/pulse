import {
  basicCredential,
  bearerCredential,
  type Credential,
  noCredential,
} from "@miragon/pulse-http"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import type { ClientCredentialsSources } from "./client-credentials-sources.js"

export class WireCredentials {
  static of(credentials: EngineCredentials, sources: ClientCredentialsSources): Credential {
    switch (credentials.kind) {
      case "none":
        return noCredential
      case "basic":
        return basicCredential(credentials.username, credentials.password)
      case "clientCredentials":
        return bearerCredential(sources.of(credentials))
    }
  }

  static tokenEndpointOf(credentials: EngineCredentials): string | undefined {
    return credentials.kind === "clientCredentials" ? credentials.tokenEndpoint : undefined
  }
}
