/**
 * The OAuth logins after `operate config set|unset|delete` (design §16.5): a login is cached per
 * origin and stored OAuth settings, so an edit that changes a profile's settings or deletes it
 * removes the login of its previous settings when no other OAuth profile of the file uses it
 * (under the cache lock, so that a refresh in flight cannot write it back; not revoked). The
 * login of a repository stays: other worktrees and project files of the repository may still
 * use it. `config set` says which profiles share the profile's login, or how to log in.
 */

import { loginCommand } from '../../auth/oauth/errors.js';
import { loginFileName, removeCache, withCacheLock } from '../../auth/oauth/cache.js';
import { pathModule } from '../../config/file.js';
import { configOrigin, loginKeyOf, loginProfiles, sameLoginKey } from '../../config/login-key.js';
import { projectOrigin } from '../../config/project.js';
import { findProfile } from '../../config/resolve.js';
import {
  type ConfigFile,
  DEFAULT_TIMEOUT_MS,
  type LoginKey,
  type Profile,
} from '../../config/types.js';
import type { Runtime } from '../../runtime.js';
import { oauthDeps } from '../session.js';
import { oldLoginFiles, quotedNames } from './auth-shared.js';
import type { EditTarget } from './config-project.js';

/** An edit of profile `name`: the profile before, the file after and where it was written. */
export interface ProfileChange {
  readonly name: string;
  readonly before: Profile | undefined;
  readonly after: ConfigFile;
  readonly target: EditTarget;
}

/** A change and the origin of the profiles of the edited file. */
interface Edited extends ProfileChange {
  readonly origin: string;
}

function cacheDeps(runtime: Runtime) {
  return oauthDeps(runtime, { timeoutMs: DEFAULT_TIMEOUT_MS, verbose: false, showSecrets: false });
}

/** The origin of the profiles of the edited file. */
function originOfTarget(target: EditTarget, runtime: Runtime): Promise<string> | string {
  return target.project
    ? projectOrigin(runtime.fs, target.path, runtime)
    : configOrigin(target.path, runtime.cwd, runtime.platform);
}

/** The OAuth profiles of the edited file that use the login of `key`. */
function users(edited: Edited, key: LoginKey): string[] {
  return loginProfiles({ ...edited.after, origin: edited.origin }, key);
}

/** The cache file of `key`, if it exists. */
async function cachedLogin(key: LoginKey, runtime: Runtime): Promise<string | undefined> {
  const path = cacheDeps(runtime).tokenPath(await loginFileName(key));
  return (await runtime.fs.exists(path)) ? path : undefined;
}

/**
 * Removes the cached login of the profile's settings before the edit when the edit changed them
 * (or deleted the profile) and no OAuth profile of the file uses it any more; keeps that of a
 * repository with a note. A profile without stored OAuth settings has a login of its own (OAuth
 * from OPERATE_AUTH), so its login goes with it, too.
 */
async function releaseLogin(edited: Edited, runtime: Runtime): Promise<void> {
  const { before, name } = edited;
  if (before === undefined) return;
  const key = loginKeyOf(edited.origin, before.auth, name);
  const now = findProfile(edited.after, name);
  if (now !== undefined && sameLoginKey(key, loginKeyOf(edited.origin, now.auth, name))) return;
  if (users(edited, key).length > 0) return;
  const path = await cachedLogin(key, runtime);
  if (path === undefined) return;
  const whose = `profile "${name}"${now === undefined ? '' : ' for its previous settings'}`;
  if (edited.origin.startsWith('repository:')) {
    runtime.stderr.write(
      `Notice: kept the OAuth login of ${whose} (${path}): other worktrees and project files of the repository may still use it. It was not revoked; delete the file once none does.\n`,
    );
    return;
  }
  const deps = cacheDeps(runtime);
  if (!(await withCacheLock(path, deps, () => removeCache(path, deps)))) return;
  runtime.stderr.write(`Removed the OAuth login of ${whose} (${path}); it was not revoked.\n`);
}

/** The command a person runs to log in the profile of the edited file. */
function loginOf(edited: Edited, runtime: Runtime): string {
  const { name, target } = edited;
  if (target.explicit !== true) return loginCommand({ profile: name });
  const configFile = pathModule(runtime.platform).resolve(runtime.cwd, target.path);
  return loginCommand({ profile: name, configFile });
}

/**
 * The note after `config set` of an OAuth profile: the profiles whose login it shares, when one is
 * cached; else how to log in. None when the profile has its own cached login already.
 */
async function loginNotice(edited: Edited, runtime: Runtime): Promise<string | undefined> {
  const after = findProfile(edited.after, edited.name);
  if (after?.auth?.type !== 'oauth') return undefined;
  const key = loginKeyOf(edited.origin, after.auth);
  if ((await cachedLogin(key, runtime)) === undefined) {
    return `Next: run \`${loginOf(edited, runtime)}\` in a terminal to log in.`;
  }
  const others = users(edited, key).filter((name) => name !== edited.name);
  if (others.length === 0) return undefined;
  const profiles = others.length === 1 ? 'profile' : 'profiles';
  return `Notice: the profile uses the OAuth login of ${profiles} ${quotedNames(others)}: same issuer, client, audience and scopes.`;
}

/**
 * `config delete`: removes the logins operate 0.7.0 and earlier cached under the profile's name,
 * as it did then (not revoked; no command reads them any more).
 */
async function removeOldLogins(edited: Edited, runtime: Runtime): Promise<void> {
  if (edited.before === undefined || findProfile(edited.after, edited.name) !== undefined) return;
  const deps = cacheDeps(runtime);
  for (const path of await oldLoginFiles(edited.name, deps)) {
    if (!(await withCacheLock(path, deps, () => removeCache(path, deps)))) continue;
    runtime.stderr.write(
      `Removed the login that operate 0.7.0 or earlier cached for profile "${edited.name}" (${path}); it was not revoked.\n`,
    );
  }
}

/**
 * What an edit does to the cached logins (`releaseLogin`, `removeOldLogins`); after `config set`
 * (`set`) also the note on the profile's login.
 */
export async function editedLogins(
  change: ProfileChange,
  runtime: Runtime,
  set: boolean,
): Promise<void> {
  const edited = { ...change, origin: await originOfTarget(change.target, runtime) };
  await releaseLogin(edited, runtime);
  await removeOldLogins(edited, runtime);
  const notice = set ? await loginNotice(edited, runtime) : undefined;
  if (notice !== undefined) runtime.stderr.write(`${notice}\n`);
}
