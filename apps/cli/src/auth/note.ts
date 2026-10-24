/**
 * A note that every auth failure of a provider carries (design §18): a bearer token that is set
 * (OPERATE_TOKEN) but not used because the profile or OPERATE_AUTH selects Basic auth or OAuth.
 * Without it, LOGIN_REQUIRED would tell an agent to ask for an OAuth login and a 401 would blame
 * the Basic credentials, and neither would mention the token the agent exported.
 */

import { OperateError } from '../errors.js';
import type { AuthPreview, AuthProvider } from './types.js';

/** Failures of `headers()` and `refresh()` that the note explains. */
const NOTED_CODES: ReadonlySet<string> = new Set(['LOGIN_REQUIRED']);

function withHint(error: OperateError, note: string): OperateError {
  const { hint } = error.details;
  const details = { ...error.details, hint: hint === undefined ? note : `${hint} ${note}` };
  return new OperateError(error.code, error.message, details, error.cause);
}

function noted(note: string): (error: unknown) => never {
  return (error) => {
    throw error instanceof OperateError && NOTED_CODES.has(error.code)
      ? withHint(error, note)
      : error;
  };
}

/**
 * `provider` with `note` appended to the hints of LOGIN_REQUIRED and to the dry-run note, and
 * exposed as `note` for the 401/403 hints (src/http/errors.ts). Getters (the OAuth principal) and
 * methods keep working on the provider itself. Without a note the provider is returned as it is.
 */
export function withAuthNote(provider: AuthProvider, note: string | undefined): AuthProvider {
  if (note === undefined) return provider;
  const fail = noted(note);
  return {
    type: provider.type,
    note,
    get principal() {
      return provider.principal;
    },
    ...(provider.off === undefined ? {} : { off: provider.off }),
    ...(provider.loginStatusCommand === undefined
      ? {}
      : { loginStatusCommand: provider.loginStatusCommand }),
    headers: () => provider.headers().catch(fail),
    ...(provider.refresh === undefined
      ? {}
      : { refresh: () => provider.refresh?.().catch(fail) ?? Promise.resolve(false) }),
    preview: async (): Promise<AuthPreview> => {
      const preview = (await provider.preview?.()) ?? { headers: {} };
      return preview.note === undefined ? preview : { ...preview, note: `${preview.note} ${note}` };
    },
    ...(provider.rejectedHint === undefined
      ? {}
      : { rejectedHint: (status: number) => provider.rejectedHint?.(status) }),
  };
}
