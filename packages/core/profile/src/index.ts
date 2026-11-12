/**
 * @miragon/pulse-profile: the one profile format of the Pulse CLI, Pulse for VS Code and the
 * Pulse MCP server. The parser takes the text of a profile file and the credential policy of
 * where it comes from, and returns a verdict per profile as data; `refusalsOn` tells which usable
 * profiles a reader cannot serve; `describeProblem` words a problem without a value. No runtime
 * dependency, no file system, no environment: the reader finds and reads the file, resolves the
 * secrets and says what follows.
 */

export {
  AUTH_KEYS,
  AUTH_TYPES,
  type AuthKey,
  type AuthType,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  CREDENTIAL_POLICIES,
  type CredentialPolicy,
  DEFAULT_FLAVOR,
  type Dialect,
  type Flavor,
  FLAVORS,
  OAUTH_AUTH_KEYS,
  OUTPUT_FORMATS,
  type OutputFormat,
  PROBLEM_CODES,
  type Problem,
  type ProblemCode,
  type Profile,
  type ProfileAuth,
  type ProfileFile,
  PROFILE_KEYS,
  type ProfileKey,
  type ProfileVerdict,
  ROOT_KEYS,
  SECRET_KEYS,
  SECRET_VARIABLE_PREFIX,
  VARIABLE_KEYS,
} from "./types.js"
export { defaultProfileOf, type ParseOptions, parseProfileFile } from "./parse.js"
export { authTypeOf, dialectOf, refusalsOn, type Surface } from "./surface.js"
export { describeProblem } from "./describe.js"
export {
  credentialsInClearText,
  isLoopbackHost,
  normalizeCockpitUrl,
  normalizeUrl,
  urlProblem,
  type UrlProblemCode,
} from "./url.js"
export { isHeaderName, isHeaderValue, isSecretHeader } from "./headers.js"
export { isRedirectPort, isScopeList, isUsername } from "./auth.js"
export { isEngineName, isTimeout, MAX_TIMEOUT_MS } from "./profile.js"
export { ENV_NAME, ENVIRONMENT_ID, isConventionalVariable, PROFILE_NAME } from "./syntax.js"
export { jsonErrorPosition } from "./json-text.js"
