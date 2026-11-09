# Error-path goldens of the CLI

What the CLI writes when an engine call fails, pinned byte for byte before its transport changes:
each later step proves "the same output, except the named fixes". The test is
`apps/cli/src/cli/goldens/error-paths.golden.test.ts`; it runs the CLI (`run`, the fake runtime
with the real `fetch`) against loopback engines (`apps/cli/test/support/loopback-engine.ts`) and
reads one process instance (`pulse process-instance get pi-1`, a generated command, a single GET)
unless a case names its own command lines. Where step 14 swaps the workflow commands' own path
(their operation lookup and failure mapping), a case runs `pulse inspect pi-1` as well; three
cases run the generated command once more with `-o table`, the error as a person reads it. The
cases and the engine answers that make them are `apps/cli/test/support/error-cases.ts`, the same
on every surface. The output goldens of `pulse status` and `pulse inspect` sit in
`apps/cli/test/__golden__/outputs`.

A golden holds the case, the environment it runs with (`config`), and per command line the exit
code, stdout and stderr (as lines: joined with a line break they are the bytes) and the requests
the engine saw (`sent`, sorted: a command that sends more than one request starts its reads in
parallel, with the Authorization they carried). Ports read `127.0.0.1:<port>`. Each command line
names its round, the reads it starts before any answer, and the engine answers none before they
all arrived, so whether a parallel read still went out never depends on timing; a round the
command does not fill fails the case after two seconds and names the count to set.

Never edit a golden by hand. An intended change runs
`pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update` (refused in CI) and commits
the diff. The MCP server (`apps/mcp-server/test/__golden__/error-paths`) and the C7 adapter of
Pulse for VS Code and Pulse for Orca
(`packages/connectors/c7/c7-adapter/test/__golden__/error-paths`) pin the same cases under
the same names.

The network codes (ECONNREFUSED, ENOTFOUND, DEPTH_ZERO_SELF_SIGNED_CERT) come from Node, not from
the CLI; they are checked with Node 22.23.4 (CI runs the newest Node 22) and 24.15.0. `dns-failure`
needs a resolver that answers `.invalid` with NXDOMAIN: offline the lookup fails with EAI_AGAIN,
and a resolver that rewrites NXDOMAIN reaches a real host.

Steps are those of the transport plan (3.1): 11 moves the CLI's settings into the shared profile,
14 puts it on `@miragon/pulse-http` ("byte for byte except the masking": passwords and tokens
masked in engine texts, JSON messages cut). Only the two `engine-text-echoes-secret-*` cases echo
a secret or a long message, so only they should change.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | 302 to a login page: HTTP_REDIRECT, exit 3, the target without its query; for `get` and `inspect` | none planned |
| `unauthorized-none` | pinned | 401 without a body: UNAUTHORIZED, exit 4, the ways to log in; for `get` as JSON and as text and for `inspect` | none planned |
| `unauthorized-basic` | pinned | 401 to Basic `demo`/`demo-secret`, the header as sent | none planned |
| `unauthorized-bearer` | pinned | 401 to a static bearer token from PULSE_CLI_TOKEN | none planned |
| `unauthorized-passthrough` | not reachable | the CLI has no caller whose token it could forward: passthrough is the MCP server's alone | |
| `wrong-rest-root` | pinned | the URL lacks `/engine-rest`: a servlet container's HTML 404, NOT_FOUND with the root hint; for `get` as JSON and as text and for `inspect` | none planned |
| `missing-resource` | pinned | 404 `InvalidRequestException`: NOT_FOUND, exit 5, the engine's message for `get`, the instance missing at runtime and in the history for `inspect` | none planned |
| `engine-text-echoes-secret-basic` | pinned | known bug: a 500 whose message echoes the Basic value, the password and a token comes out whole, the configured password and Basic value unmasked | 14 (masked, cut) |
| `engine-text-echoes-secret-bearer` | pinned | known bug: the same message to a static bearer token, the token unmasked | 14 (masked, cut) |
| `deadline-exceeded` | pinned | PULSE_CLI_TIMEOUT=300 against an engine that never answers: TIMEOUT, exit 8; for `get` and `inspect` | none planned |
| `unreachable` | pinned | a closed loopback port: NETWORK, ECONNREFUSED; as JSON and as text | none planned |
| `tls-failure` | pinned | a self-signed certificate: NETWORK with the certificate hint | none planned |
| `dns-failure` | pinned | a host under `.invalid`: NETWORK with the host name hint | none planned |
| `too-large-response` | deferred | the CLI buffers any answer and the plan gives it no cap (2.4), so an answer of any size only succeeds; pinned once a cap arrives | |
| `basic-password-euro` | pinned | Basic as UTF-8: the read succeeds, the header as sent | none planned |
| `path-value-dot` | pinned | `pulse process-instance get .` and `..` are refused before anything is sent: USAGE, exit 2 | none planned |
| `double-slash-root` | pinned | a URL ending in `//`: the slashes are trimmed, the read succeeds | none planned |
| `token-line-break-inside` | pinned | refused as CONFIG, exit 3, without echoing the token | none planned |
| `token-line-break-trailing` | pinned | a trailing line break is trimmed: the read succeeds | none planned |
| `integer-beyond-2-53` | pinned | a Long variable 9223372036854775807 keeps its digits in `get-variables` and in `pulse inspect` | none planned |
