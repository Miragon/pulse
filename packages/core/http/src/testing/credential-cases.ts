/**
 * The conformance cases of the credential: what each sends, the one second attempt after a 401
 * a renewable credential earns, and the secrets no text may show.
 */
import {
  connection,
  DEMO,
  DEMO_BASIC,
  ECHOES_SECRETS,
  INSTANCE,
  NO_CONTENT,
  READ,
  TOKEN,
  UNAUTHORIZED,
  WRITE,
  WRITE_BODY,
} from "./parts.js"
import type { TransportCase } from "./types.js"

const RENEWING = connection({
  credential: { type: "renewable", tokens: ["tok-old-1", "tok-new-2"] },
})

export const CREDENTIAL_CASES: readonly TransportCase[] = [
  {
    name: "unauthorized-none",
    about: "a 401 without credentials fails once, without a header",
    connection: connection(),
    request: READ,
    answers: [UNAUTHORIZED],
    expect: { outcome: "unauthorized", status: 401, sent: 1, authorization: [null] },
  },
  {
    name: "unauthorized-basic",
    about: "Basic is not renewable: a 401 fails after one request",
    connection: connection({ credential: DEMO }),
    request: READ,
    answers: [UNAUTHORIZED],
    expect: {
      outcome: "unauthorized",
      status: 401,
      sent: 1,
      authorization: [`Basic ${DEMO_BASIC}`],
      never: ["demo-secret", DEMO_BASIC],
    },
  },
  {
    name: "unauthorized-bearer",
    about: "a fixed token is not renewable: a 401 fails after one request",
    connection: connection({ credential: TOKEN }),
    request: READ,
    answers: [UNAUTHORIZED],
    expect: {
      outcome: "unauthorized",
      status: 401,
      sent: 1,
      authorization: ["Bearer tok-demo-123"],
      never: ["tok-demo-123"],
    },
  },
  {
    name: "unauthorized-passthrough",
    about: "the caller's token is forwarded and never renewed",
    connection: connection({ credential: { type: "caller", token: "caller-token-42" } }),
    request: READ,
    answers: [UNAUTHORIZED],
    expect: {
      outcome: "unauthorized",
      status: 401,
      sent: 1,
      authorization: ["Bearer caller-token-42"],
      never: ["caller-token-42"],
    },
  },
  {
    name: "unauthorized-renewed",
    about: "a renewable credential earns exactly one second attempt, with the new token",
    connection: RENEWING,
    request: READ,
    answers: [UNAUTHORIZED, INSTANCE],
    expect: {
      outcome: "answered",
      status: 200,
      sent: 2,
      authorization: ["Bearer tok-old-1", "Bearer tok-new-2"],
    },
  },
  {
    name: "unauthorized-after-the-one-retry",
    about: "a second 401 fails, even though the credential could renew once more",
    connection: connection({
      credential: { type: "renewable", tokens: ["tok-one-1", "tok-two-2", "tok-three-3"] },
    }),
    request: READ,
    answers: [UNAUTHORIZED],
    expect: {
      outcome: "unauthorized",
      status: 401,
      sent: 2,
      authorization: ["Bearer tok-one-1", "Bearer tok-two-2"],
    },
  },
  {
    name: "unauthorized-renewed-write",
    about: "the second attempt of a write sends the same body",
    connection: RENEWING,
    request: WRITE,
    answers: [UNAUTHORIZED, NO_CONTENT],
    expect: {
      outcome: "answered",
      status: 204,
      sent: 2,
      bodies: [WRITE_BODY, WRITE_BODY],
    },
  },
  {
    name: "engine-text-echoes-secret-basic",
    about: "a 500 that echoes the password and the Basic value shows neither",
    connection: connection({ credential: DEMO }),
    request: READ,
    answers: [ECHOES_SECRETS],
    expect: {
      outcome: "status",
      status: 500,
      mayHaveApplied: false,
      sent: 1,
      contains: ["***", "ENGINE-16004", "ProcessEngineException"],
      never: ["demo-secret", DEMO_BASIC],
    },
  },
  {
    name: "engine-text-echoes-secret-bearer",
    about: "the same 500 to a bearer token shows no token",
    connection: connection({ credential: TOKEN }),
    request: READ,
    answers: [ECHOES_SECRETS],
    expect: {
      outcome: "status",
      status: 500,
      mayHaveApplied: false,
      sent: 1,
      contains: ["***", "ENGINE-16004"],
      never: ["tok-demo-123"],
    },
  },
  {
    name: "basic-password-euro",
    about: "Basic is UTF-8 (RFC 7617): a euro sign in the password works",
    connection: connection({
      credential: { type: "basic", username: "demo", password: "€uro-secret" },
    }),
    request: READ,
    answers: [INSTANCE],
    expect: {
      outcome: "answered",
      status: 200,
      sent: 1,
      authorization: ["Basic ZGVtbzrigqx1cm8tc2VjcmV0"],
    },
  },
  {
    name: "token-line-break-inside",
    about: "a line break inside a token refuses the credential, never echoing it",
    connection: connection({ credential: { type: "bearer", token: "tok-demo\n123" } }),
    request: READ,
    answers: [INSTANCE],
    expect: { outcome: "credential", sent: 0, never: ["tok-demo"] },
  },
  {
    name: "token-line-break-trailing",
    about: "a token's trailing line break (a secret file's last line) is trimmed",
    connection: connection({ credential: { type: "bearer", token: "tok-demo-123\n" } }),
    request: READ,
    answers: [INSTANCE],
    expect: {
      outcome: "answered",
      status: 200,
      sent: 1,
      authorization: ["Bearer tok-demo-123"],
    },
  },
]
