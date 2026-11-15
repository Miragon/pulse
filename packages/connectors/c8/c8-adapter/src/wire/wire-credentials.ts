import {
  basicCredential,
  bearerCredential,
  type Credential,
  noCredential,
} from "@miragon/pulse-http"
import type { EngineConnection, EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import type { ClientCredentialsSources } from "./client-credentials-sources.js"

export class WireCredentials {
  static of(connection: EngineConnection, sources: ClientCredentialsSources): Credential {
    const credentials = connection.credentials
    switch (credentials.kind) {
      case "none":
        return noCredential
      case "basic":
        return basicCredential(credentials.username, credentials.password)
      case "clientCredentials":
        return bearerCredential(sources.of(connection.endpoint, credentials))
    }
  }

  static tokenEndpointOf(credentials: EngineCredentials): string | undefined {
    return credentials.kind === "clientCredentials" ? credentials.tokenEndpoint : undefined
  }
}
