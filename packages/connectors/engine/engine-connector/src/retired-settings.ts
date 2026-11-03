/**
 * The names the engine module carried up to 0.24, when it was the `camunda7` module. The boot
 * refuses each while it is set and names its replacement (`engineModule.retired`), so an upgrade
 * with old settings never boots without the engine or ignores a setting silently.
 */

/** What the engine module was called up to 0.24: the boot refuses each while it is set. */
export const RETIRED_MODULE_NAMES = ["camunda7"] as const

/** Retired server variable -> the variable that replaces it (values unchanged). */
export const RETIRED_ENV_VARS = {
  CAMUNDA_ENGINES_FILE: "ENGINES_FILE",
  CAMUNDA_ENGINES_JSON: "ENGINES_JSON",
  CAMUNDA_BASE_URL: "ENGINE_BASE_URL",
  CAMUNDA_ENGINE_ID: "ENGINE_ID",
  CAMUNDA_ENGINE_FLAVOR: "ENGINE_FLAVOR",
  CAMUNDA_DEFAULT_ENGINE: "ENGINE_DEFAULT",
  CAMUNDA_COCKPIT_URL: "ENGINE_COCKPIT_URL",
  CAMUNDA_AUTH_TYPE: "ENGINE_AUTH_TYPE",
  CAMUNDA_INCIDENT_ISSUE_REPO: "ENGINE_INCIDENT_ISSUE_REPO",
  CAMUNDA_HEALTH_CRITICAL_INCIDENTS: "ENGINE_HEALTH_CRITICAL_INCIDENTS",
  CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE: "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE",
  CAMUNDA_ALLOW_DEPLOYMENTS: "ENGINE_ALLOW_DEPLOYMENTS",
  CAMUNDA_REQUEST_TIMEOUT_MS: "ENGINE_REQUEST_TIMEOUT_MS",
} as const

/**
 * Retired credentials -> their replacements: the boot only WARNS on these. A shell may export
 * CAMUNDA_PASSWORD for pulse-cli (its docs use the name for `--auth-password-env`), and a missing
 * replacement fails the auth check anyway ("requires ENGINE_USERNAME and ENGINE_PASSWORD").
 */
export const RETIRED_CREDENTIAL_ENV_VARS = {
  CAMUNDA_USERNAME: "ENGINE_USERNAME",
  CAMUNDA_PASSWORD: "ENGINE_PASSWORD",
  CAMUNDA_TOKEN: "ENGINE_TOKEN",
} as const
