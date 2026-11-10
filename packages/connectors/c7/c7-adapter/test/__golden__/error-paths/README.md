# Error-path goldens of the C7 adapter

What the C7 adapter of Pulse for VS Code and Pulse for Orca reports when an engine call fails,
pinned byte for byte before its transport changes: each later step proves "the same report, except
the named fixes". The test is
`packages/connectors/c7/c7-adapter/test/goldens/error-paths.golden.test.ts`; it builds the
adapter's runtime (`C7Adapter` over the real `fetch`) against loopback engines
(`packages/connectors/c7/c7-adapter/test/goldens/loopback-engine.ts`) and asks
`describeEngine()` unless a case names its own calls. Where step 15 swapped the inspect path
(its own operation table for c7-core's `CORE_ROUTES`), a case asks `getInstanceDetail` of one
instance as well, its world in `packages/connectors/c7/c7-adapter/test/goldens/inspect-world.ts`. The cases and the engine
answers that make them are `packages/connectors/c7/c7-adapter/test/goldens/error-cases.ts`,
the same on every surface; that copy may carry no comment, so the server's and the CLI's copies
explain the answers.

A golden holds the case, the connection (endpoint and credentials), and per call its outcome (the
value, or the `RuntimeError`'s failure, message and hint) and the requests the engine saw (`sent`,
with the Authorization they carried): in arrival order for `describeEngine`, whose reads run one
after another (the product, then the version on a 404), sorted for `getInstanceDetail`, whose
reads run in parallel. Ports read `127.0.0.1:<port>`. The engines answer like the Tomcat CIB seven
runs in: a status line without a reason phrase. Each call names its round, the reads it starts
before any answer, and the engine answers none before they all arrived, so whether a parallel
read still went out never depends on timing; a round the call does not fill fails the case after
two seconds and names the count to set.

Never edit a golden by hand. An intended change runs
`pnpm --fail-if-no-match --filter @miragon/pulse-c7-adapter golden:update` (refused in CI) and
commits the diff. The MCP server (`apps/mcp-server/test/__golden__/error-paths`) and the CLI
(`apps/cli/test/__golden__/error-paths`) pin the same cases under the same names.

The network codes (ECONNREFUSED, ENOTFOUND, DEPTH_ZERO_SELF_SIGNED_CERT) come from Node, not from
the adapter; they are checked with Node 22.23.4 (CI runs the newest Node 22) and 24.15.0.
`dns-failure` needs a resolver that answers `.invalid` with NXDOMAIN: offline the lookup fails
with EAI_AGAIN, and a resolver that rewrites NXDOMAIN reaches a real host.

Steps are those of the transport plan (3.1): 11 moved the connections onto the shared profile, 15
put the adapter on `@miragon/pulse-http`: the failures read as before (`ErrorTranslation`, the
adapter's own table), but a 404 of no engine resource and a redirect add a hint to the REST root,
a status names its phrase (HTTP 401 Unauthorized), an engine text reads the request's credentials
as `***` and is cut after 500 characters on one line, and TLS and DNS name their own reason and
what to check. Only the seven cases with a 15 below changed.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | a 302 to a login page: `misconfigured`, its target without the query and the hint to the REST root, nothing followed; for `describeEngine` and `getInstanceDetail` | 15 (root hint, status phrase) |
| `unauthorized-none` | pinned | 401: `unauthorized` "HTTP 401 Unauthorized"; for `describeEngine` and `getInstanceDetail` | 15 (status phrase) |
| `unauthorized-basic` | pinned | the same to Basic `demo`/`demo-secret`, the header as sent | 15 (status phrase) |
| `unauthorized-bearer` | not reachable | the adapter knows only no credentials and Basic (`EngineCredentials`); a token profile is refused before any adapter runs | |
| `unauthorized-passthrough` | not reachable | the extension has no caller whose token it could forward: passthrough is the MCP server's alone | |
| `wrong-rest-root` | pinned | the URL lacks `/engine-rest`, the product read and its version fallback both get the container's HTML 404: `misconfigured` "HTTP 404 Not Found" with the root hint; the same for `getInstanceDetail` | 15 (root hint, status phrase) |
| `missing-resource` | pinned | 404 `InvalidRequestException` for runtime and history: `getInstanceDetail` returns no detail | none planned |
| `engine-text-echoes-secret-basic` | pinned | a 500 whose message echoes the Basic value, the password and a token: `engineFailure`, the configured password and Basic value read `***`, the other token stays, the message on one line and cut after 500 characters | 15 (masked, cut) |
| `engine-text-echoes-secret-bearer` | not reachable | no bearer credential in the adapter (see `unauthorized-bearer`) | |
| `deadline-exceeded` | pinned | an engine that never answers: `unreachable`. The test turns the transport's timer of 60000 ms into one of 300 ms, so the text names the adapter's own 60000 ms; for `describeEngine` and `getInstanceDetail` | none planned |
| `unreachable` | pinned | a closed loopback port: `unreachable`, ECONNREFUSED | none planned |
| `tls-failure` | pinned | a self-signed certificate: `unreachable`, the failed TLS handshake with the code and the certificate hint | 15 (TLS as its own reason) |
| `dns-failure` | pinned | a host under `.invalid`: `unreachable`, the host name that does not resolve with ENOTFOUND and the host name hint | 15 (DNS as its own reason) |
| `too-large-response` | pinned | a Content-Length above 64 MiB: `unexpectedResponse` before the body is read (the smallest answer that shows the cap); the cap is the transport's since step 15, the text the same | none planned |
| `basic-password-euro` | pinned | Basic as UTF-8: the read succeeds, the header as sent | none planned |
| `path-value-dot` | pinned | the ids "." and ".." are refused before anything is sent, and `getInstanceDetail` reads the refusal as no detail | none planned |
| `double-slash-root` | pinned | an endpoint ending in `//`: the slashes are trimmed, the read succeeds | none planned |
| `token-line-break-inside` | not reachable | no bearer credential in the adapter (see `unauthorized-bearer`) | |
| `token-line-break-trailing` | not reachable | no bearer credential in the adapter (see `unauthorized-bearer`) | |
| `integer-beyond-2-53` | pinned | a Long variable 9223372036854775807 keeps its digits in the variable's `valueJson` | none planned |
