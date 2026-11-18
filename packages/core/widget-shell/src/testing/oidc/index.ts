/**
 * `@miragon/pulse-widget-shell/testing/oidc`: a fake OpenID Connect provider on a loopback socket,
 * with Keycloak's paths, ADFS's or an Entra ID tenant's (`flavor`), which the web sign-in's tests
 * run against, here and in a server's own suites. Node only, never bundled.
 */
export { startFakeOidc, type FakeEntraTenant, type FakeOidc } from "./fake-oidc.js"
export type { FakeOidcEndpoint, FakeOidcRequest } from "./endpoints.js"
export {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  type EndedSession,
  type FakeOidcClient,
  type FakeOidcFlavor,
  type FakeOidcOptions,
  type FakeOidcUser,
  type IssuedTokens,
} from "./realm.js"
