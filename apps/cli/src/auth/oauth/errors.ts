/**
 * The errors of the OAuth flow. LOGIN_REQUIRED (exit 4) means a person must run
 * `pulse-cli auth login` in a terminal; agents cannot log in themselves, so the hint says who does
 * what. LOGIN_FAILED (exit 4) is a login that did not complete.
 */

import type { OAuthConfig } from "../../config/types.js"
import { OperateError } from "../../errors.js"
import { canRefresh, isExpired } from "./expiry.js"
import { identityDifferences } from "./identity.js"
import type { CachedLogin, LoginIdentity } from "./types.js"

/** Whose login it is in messages: `profile "p"`, or the configuration from the environment. */
export function owner(profile: string | undefined): string {
  return profile === undefined ? "the environment configuration" : `profile "${profile}"`
}

/** `(profile "p")`, or `(no profile)`, for the lines of `pulse-cli auth login`. */
export function profileNote(profile: string | undefined): string {
  return profile === undefined ? "(no profile)" : `(profile "${profile}")`
}

/**
 * Whose login a message is about and where a person logs in for it: logins are
 * cached per origin, so the login must run with the same config file or project file. The
 * resolved OAuthConfig is one.
 */
export interface LoginOwner {
  readonly profile?: string | undefined
  /** The directory of the project file the profile comes from. */
  readonly projectDirectory?: string | undefined
  /** The config file named by `--config` or PULSE_CLI_CONFIG the profile comes from. */
  readonly configFile?: string | undefined
}

/** A path as one shell word: as it is when it needs no quotes, else in single quotes. */
function shellWord(path: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`
}

/** `pulse-cli auth <command> [--config <file>] [--profile <p>]` for the login of `who`. */
function authCommand(command: string, who: LoginOwner): string {
  if (who.profile === undefined) return `pulse-cli auth ${command}`
  const config = who.configFile === undefined ? "" : ` --config ${shellWord(who.configFile)}`
  return `pulse-cli auth ${command}${config} --profile ${who.profile}`
}

/** The command a person runs to log in. */
export function loginCommand(who: LoginOwner): string {
  return authCommand("login", who)
}

/** The command that shows the login (no network access). */
export function statusCommand(who: LoginOwner): string {
  return authCommand("status", who)
}

/**
 * `` `pulse-cli auth login ...` in a terminal ``, and where: a profile of a project file is logged in
 * where that file applies. Without a profile the person needs PULSE_CLI_AUTH=oauth too: `auth login`
 * has no `--auth` option, so an agent's `--auth oauth` does not carry over.
 */
export function inTerminal(who: LoginOwner): string {
  const where = who.projectDirectory === undefined ? "" : ` in ${who.projectDirectory}`
  const settings =
    who.profile === undefined
      ? " with PULSE_CLI_AUTH=oauth and the same PULSE_CLI_OAUTH_* settings"
      : ""
  return `\`${loginCommand(who)}\` in a terminal${where}${settings}`
}

/** The hint of every LOGIN_REQUIRED error. */
export function loginHint(who: LoginOwner): string {
  return `Run ${inTerminal(who)}: a person logs in once in the browser, pulse-cli refreshes the token afterwards. Agents cannot log in themselves.`
}

/** LOGIN_REQUIRED with the login hint, after an optional explanation. */
export function loginRequired(message: string, who: LoginOwner, why?: string) {
  const login = loginHint(who)
  const hint = why === undefined ? login : `${why} ${login}`
  return new OperateError("LOGIN_REQUIRED", message, { hint })
}

export function loginFailed(message: string, hint: string): OperateError {
  return new OperateError("LOGIN_FAILED", message, { hint })
}

export function iso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** What one login serves, for the hint of a profile that has none. */
const SHARED_LOGIN =
  "One login serves every OAuth profile of the same config file, project file or repository that stores the same issuer, client, audience and scopes."

/** LOGIN_REQUIRED without a cached login. */
export function notLoggedIn(who: LoginOwner): OperateError {
  const message = `Not logged in: ${owner(who.profile)} has no OAuth login`
  return loginRequired(message, who, who.profile === undefined ? undefined : SHARED_LOGIN)
}

/**
 * LOGIN_REQUIRED for a cached login of another identity: the message names the fields that
 * differ, the hint the PULSE_CLI_OAUTH_* variables that changed them (the person's terminal must
 * set them too, or the agent must drop them), else that the settings changed since the login.
 */
export function otherIdentity(stored: LoginIdentity, config: OAuthConfig): OperateError {
  const differences = identityDifferences(stored, config)
  const details = differences.map((difference) => difference.text).join("; ")
  const variables = differences.flatMap((difference) =>
    difference.variable === undefined ? [] : [difference.variable],
  )
  const why =
    variables.length === 0
      ? "The login was made with other settings: PULSE_CLI_OAUTH_* variables were set where the login ran (also through another profile that shares the login)."
      : `${variables.join(", ")} of this environment ${variables.length > 1 ? "make" : "makes"} the difference: run the login below with the same ${variables.length > 1 ? "values" : "value"}, or unset ${variables.length > 1 ? "them" : "it"} here.`
  return loginRequired(
    `The OAuth login of ${owner(config.profile)} was made for another issuer, client, audience or scopes: ${details}`,
    config,
    why,
  )
}

export function unknownFormat(path: string, who: LoginOwner): OperateError {
  return loginRequired(`The token cache ${path} has an unknown format`, who)
}

export function removedWhileRunning(who: LoginOwner): OperateError {
  return loginRequired(
    `The OAuth login of ${owner(who.profile)} was removed while this command ran`,
    who,
    "A logout (also of a profile that shares the login) or `pulse-cli config set|unset|delete` removed it.",
  )
}

/** Why the authorization server refuses a refresh token with `invalid_grant`. */
export const REFRESH_REJECTED =
  "The session expired, was revoked, or the refresh token was replayed."

/**
 * LOGIN_REQUIRED for a login pulse-cli cannot refresh: the authorization server refused its
 * refresh token before, it has none, or an expired one.
 */
export function cannotRefresh(login: CachedLogin, now: number, who: LoginOwner) {
  const rejected = login.refreshRejected
  const whose = owner(who.profile)
  if (rejected !== undefined) {
    return loginRequired(
      `The authorization server rejected the refresh token of ${whose} at ${iso(rejected.at)} (${rejected.error})`,
      who,
      REFRESH_REJECTED,
    )
  }
  if (login.refreshToken === null) {
    return loginRequired(
      `The access token of ${whose} expired at ${iso(login.expiresAt ?? now)} and there is no refresh token`,
      who,
      "Request the offline_access scope or allow refresh tokens for the client, so that pulse-cli can refresh the token.",
    )
  }
  return loginRequired(
    `The OAuth login of ${whose} expired at ${iso(login.refreshExpiresAt ?? now)}`,
    who,
  )
}

/**
 * Throws LOGIN_REQUIRED when no command could run with the login without a person: the
 * authorization server refused its refresh token (recorded only once the access token was due
 * for a refresh or rejected), or the access token expired and there is no usable refresh token.
 */
export function checkUsable(login: CachedLogin, now: number, who: LoginOwner): void {
  const expired = isExpired(now, login.expiresAt) && !canRefresh(login, now)
  if (login.refreshRejected !== undefined || expired) throw cannotRefresh(login, now, who)
}
