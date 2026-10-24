/**
 * `operate auth logout`: revokes and removes the cached OAuth login of the
 * selected profile, found from its stored settings also when they no longer resolve, and names
 * every profile that shared it; the logins operate 0.7.0 and earlier cached under
 * the profile's name are revoked and removed, too. A token command's cached token is removed
 * (auth-bearer.ts); a bearer token from elsewhere has nothing to log out.
 */

import type { Command } from "commander"
import { cachePath } from "../../auth/oauth/cache.js"
import { iso } from "../../auth/oauth/errors.js"
import { logout, type LogoutResult, type LogoutTarget } from "../../auth/oauth/logout.js"
import type { OAuthDeps } from "../../auth/oauth/types.js"
import type { Env } from "../../config/pick.js"
import { selectedAuth } from "../../config/resolve-auth.js"
import { endpointSource } from "../../config/resolve-oauth.js"
import { parseTimeout, resolveConfig, selectProfile } from "../../config/resolve.js"
import {
  DEFAULT_TIMEOUT_MS,
  type ResolvedConfig,
  type SelectedProfile,
} from "../../config/types.js"
import type { OutputStream, Runtime } from "../../runtime.js"
import type { CliContext } from "../context.js"
import { displayOf } from "../display.js"
import { configFlags, type GlobalOptions, readGlobals } from "../globals.js"
import { loadConfig } from "../config-files.js"
import { oauthDeps, tokenScope } from "../session.js"
import { bearerNotManaged, logoutCommand } from "./auth-bearer.js"
import { printView, safeStderr } from "./auth-output.js"
import { notOAuth, notOAuthOf } from "./auth-session.js"
import { oldLoginFiles, sharedLogoutNote, storedLogin } from "./auth-shared.js"

/** The resolved configuration, or why it does not resolve (logout resolves best effort). */
function tryResolve(
  globals: GlobalOptions,
  runtime: Runtime,
  file: Parameters<typeof resolveConfig>[2],
): { readonly config: ResolvedConfig } | { readonly error: unknown } {
  try {
    return {
      config: resolveConfig(configFlags(globals), runtime.env, file, { authCommand: true }),
    }
  } catch (error) {
    return { error }
  }
}

/** Why logout has no OAuth settings to revoke a confidential login with. */
function unresolvedReason(error: unknown, profile: string | undefined): string {
  const reason = error instanceof Error ? error.message : String(error)
  return `the OAuth settings of ${profile === undefined ? "the configuration" : `profile "${profile}"`} do not resolve: ${reason}`
}

/** The request timeout of logout: resolved, else `--timeout`, else the default. */
function logoutTimeout(globals: GlobalOptions, resolved: ResolvedConfig | undefined): number {
  if (resolved !== undefined) return resolved.timeoutMs
  return globals.timeout === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(globals.timeout)
}

/** Whose login logout removes, and the OAuth settings for a confidential client's secret. */
function targetOf(
  selected: SelectedProfile,
  resolution: ReturnType<typeof tryResolve>,
): LogoutTarget {
  const resolved = "config" in resolution ? resolution.config : undefined
  const settings = resolved?.auth.type === "oauth" ? resolved.auth : undefined
  return {
    profile: selected.name,
    source:
      settings === undefined ? "the revocation endpoint cached at login" : endpointSource(settings),
    settings,
    unresolved:
      "error" in resolution ? unresolvedReason(resolution.error, selected.name) : undefined,
  }
}

/**
 * The token command of a resolved configuration, if its bearer token comes from one, with the
 * deps of its token cache (`scope`: tokenScope).
 */
function commandTarget(resolved: ResolvedConfig | undefined, deps: OAuthDeps, scope: string) {
  const auth = resolved?.auth
  return auth?.type === "bearer" && auth.command !== undefined
    ? { command: auth, deps: { ...deps, scope } }
    : undefined
}

/** What selected bearer auth for logout, or undefined when another type is selected. */
function bearerSelection(globals: GlobalOptions, env: Env, selected: SelectedProfile) {
  const auth = selectedAuth(configFlags(globals), env, selected)
  return auth?.type === "bearer"
    ? { profile: selected.name, source: auth.source, env, token: auth.token }
    : undefined
}

/** What logout works on: the selected profile and, if they resolve, the OAuth settings. */
async function logoutTarget(globals: GlobalOptions, context: CliContext) {
  const { runtime } = context
  const { config: file, project } = await loadConfig(runtime, globals.config)
  const selected = selectProfile(configFlags(globals), runtime.env, file)
  const resolution = tryResolve(globals, runtime, file)
  const resolved = "config" in resolution ? resolution.config : undefined
  const deps = oauthDeps(runtime, { ...globals, timeoutMs: logoutTimeout(globals, resolved) })
  const command = commandTarget(resolved, deps, tokenScope(project?.path, runtime))
  if (command !== undefined) return command
  const target = targetOf(selected, resolution)
  const bearer = bearerSelection(globals, runtime.env, selected)
  if (selected.name !== undefined) {
    const stored = await storedLogin(file, selected, deps)
    // a profile switched to a bearer token by hand may still have its OAuth login
    if (bearer !== undefined && !(await runtime.fs.exists(stored.tokenCache))) {
      throw bearerNotManaged("logout", bearer)
    }
    return { target, deps, ...stored }
  }
  if (bearer !== undefined) throw bearerNotManaged("logout", bearer)
  // without a profile the file name is derived from the resolved OAuth settings
  if (target.settings === undefined) {
    if ("error" in resolution) throw resolution.error
    throw notOAuth("logout", notOAuthOf(resolution.config), runtime.env)
  }
  return { target, deps, tokenCache: await cachePath(target.settings, deps), profiles: [] }
}

export async function runLogout(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context
  const globals = readGlobals(command)
  const display = await displayOf(context, globals)
  const found = await logoutTarget(globals, context)
  if ("command" in found) {
    printView(await logoutCommand(found.command, found.deps), display, runtime)
    return
  }
  const { target, deps, tokenCache, profiles } = found
  const stderr = safeStderr(runtime)
  const result = await logout(tokenCache, target, deps)
  writeLogout(stderr, result)
  const { removed, revoked } = result
  const shared = removed ? sharedLogoutNote(profiles, target.profile) : undefined
  if (shared !== undefined) stderr.write(`${shared}\n`)
  const old =
    target.profile === undefined ? [] : await logoutOld(target.profile, target, deps, stderr)
  const view = { profile: target.profile ?? null, profiles, tokenCache, removed, revoked }
  printView(old.length === 0 ? view : { ...view, oldTokenCaches: old }, display, runtime)
}

/** The warnings of a logout and until when the access token issued before stays valid. */
function writeLogout(stderr: OutputStream, result: LogoutResult): void {
  for (const warning of result.warnings) stderr.write(`${warning}\n`)
  if (result.validUntil === undefined) return
  const until = result.validUntil === null ? "it expires" : iso(result.validUntil)
  stderr.write(
    `Note: the access token issued before stays valid until ${until} at gateways that check tokens offline.\n`,
  )
}

/**
 * Revokes and removes the logins operate 0.7.0 and earlier cached under the profile's name;
 * resolves to their files.
 */
async function logoutOld(
  profile: string,
  target: LogoutTarget,
  deps: OAuthDeps,
  stderr: OutputStream,
): Promise<string[]> {
  const files = await oldLoginFiles(profile, deps)
  for (const path of files) {
    const result = await logout(path, target, deps)
    stderr.write(
      `Logged out the login that operate 0.7.0 or earlier cached for profile "${profile}" (${path}).\n`,
    )
    writeLogout(stderr, result)
  }
  return files
}
