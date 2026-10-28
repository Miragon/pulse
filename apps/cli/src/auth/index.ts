/** Creates the authentication provider for the resolved auth configuration. */

import { validateAuthType } from "../config/auth.js"
import type { AuthConfig } from "../config/types.js"
import { basicAuth } from "./basic.js"
import { bearerAuth } from "./bearer.js"
import { commandBearerAuth } from "./command-provider.js"
import { noAuth } from "./none.js"
import type { CommandProviderDeps } from "./command-provider.js"
import type { Runtime } from "../runtime.js"
import type { AuthProvider } from "./types.js"

/** What the providers need from the outside world: the clock, the token cache and the shell. */
export interface AuthDeps extends CommandProviderDeps {
  /** Runs the bearer token command (PULSE_CLI_TOKEN_COMMAND). */
  readonly runCommand: Runtime["runCommand"]
  /**
   * The directory whose commands share the cached token of PULSE_CLI_TOKEN_COMMAND: the project
   * file's directory, else the working directory (`tokenScope` of src/cli/session.ts).
   */
  readonly scope: string
}

/**
 * The provider of the configured type; `deps` serve the clock of the bearer token's expiry check
 * and the token command (shell, token cache). Throws the CONFIG
 * error of config resolution for types without a provider, e.g. a config object built without
 * `resolveConfig`. No provider can start an interactive login.
 */
export function createAuthProvider(config: AuthConfig, deps: AuthDeps): AuthProvider {
  validateAuthType(config.type)
  switch (config.type) {
    case "basic":
      return basicAuth(config)
    case "bearer":
      return config.command === undefined
        ? bearerAuth(config, deps.now)
        : commandBearerAuth(config, deps)
    case "none":
      return noAuth(config.off)
  }
}
