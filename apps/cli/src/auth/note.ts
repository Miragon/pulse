/**
 * A note that every auth failure of a provider carries: a bearer token that is set
 * (PULSE_CLI_TOKEN) but not used because the profile or PULSE_CLI_AUTH selects Basic auth.
 * Without it, a 401 would blame the Basic credentials and not mention the token the agent
 * exported.
 */

import type { AuthPreview, AuthProvider } from "./types.js"

/**
 * `provider` with `note` appended to the dry-run note, and exposed as `note` for the 401/403
 * hints (src/http/errors.ts). Getters (the principal) and methods keep working on the provider
 * itself. Without a note the provider is returned as it is.
 */
export function withAuthNote(provider: AuthProvider, note: string | undefined): AuthProvider {
  if (note === undefined) return provider
  return {
    type: provider.type,
    note,
    get principal() {
      return provider.principal
    },
    ...(provider.off === undefined ? {} : { off: provider.off }),
    headers: () => provider.headers(),
    ...(provider.refresh === undefined
      ? {}
      : { refresh: () => provider.refresh?.() ?? Promise.resolve(false) }),
    preview: async (): Promise<AuthPreview> => {
      const preview = (await provider.preview?.()) ?? { headers: {} }
      return preview.note === undefined ? preview : { ...preview, note: `${preview.note} ${note}` }
    },
    ...(provider.rejectedHint === undefined
      ? {}
      : { rejectedHint: (status: number) => provider.rejectedHint?.(status) }),
  }
}
