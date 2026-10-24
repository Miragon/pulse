/**
 * HTTP Basic authentication helpers for the engines started with `basicAuth`: the encoded
 * credentials the CLI must never print, and users created directly through the REST API (not
 * through the CLI under test).
 */

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

/** The token of `Authorization: Basic <token>`: base64 of the UTF-8 bytes of `user:password`. */
export function basicToken({ username, password }: Credentials): string {
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

/**
 * Creates a user of the engine's identity service with the administrator's credentials. Every user
 * may do everything: the Run distributions enable authorization checks only in production.yml.
 * User ids must be alphanumeric (the engines' default resource id whitelist).
 */
export async function createUser(
  engineUrl: string,
  admin: Credentials,
  user: Credentials,
): Promise<void> {
  const response = await fetch(`${engineUrl}/user/create`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicToken(admin)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: {
        id: user.username,
        firstName: 'Operate',
        lastName: 'Integration test',
        email: `${user.username}@example.com`,
      },
      credentials: { password: user.password },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cannot create user ${user.username}: HTTP ${response.status} ${body}`);
  }
}
