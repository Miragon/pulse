/**
 * `@miragon/pulse-widget-shell/testing/oidc`: a fake OpenID Connect provider with Keycloak's paths
 * on a loopback socket, which the web sign-in's tests run against, here and in a server's own
 * suites. Node only, never bundled.
 */
export { startFakeOidc, type FakeOidc } from "./fake-oidc.js"
export type { FakeOidcEndpoint, FakeOidcRequest } from "./endpoints.js"
export {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  type EndedSession,
  type FakeOidcClient,
  type FakeOidcOptions,
  type FakeOidcUser,
  type IssuedTokens,
} from "./realm.js"
