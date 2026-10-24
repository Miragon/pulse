/** No authentication: requests carry no credentials (engines without the REST auth filter). */

import type { AuthProvider } from './types.js';

/** `off` says why no credentials are sent when Basic auth was configured (for the 401 hint). */
export function noAuth(off?: string): AuthProvider {
  return {
    type: 'none',
    headers: () => Promise.resolve({}),
    ...(off === undefined ? {} : { off }),
  };
}
