# Error-path goldens of the MCP server

What the model reads when an engine call fails, pinned byte for byte before the transport
changes: each later step proves "the same text, except the named fixes". The test is
`apps/mcp-server/test/engine-goldens/error-paths.golden.test.ts`; it boots the real app
(`createApp`) against a loopback engine (`apps/mcp-server/test/engine-goldens/fake-engines.ts`)
and asks `engine_inspect_process_instance` for one instance unless a case names its own probes.
Where a later step swaps a second code path, a case asks a read of the registrar as well
(`engine_list_process_instances`, or `engine_get_process_instance_variables` for a missing
instance). The cases and the engine answers that make them are
`apps/mcp-server/test/engine-goldens/error-cases.ts`, the same on every surface. The output
goldens of the same engine reads sit in `apps/mcp-server/test/__golden__/outputs`.

A golden holds the case, the engine settings it boots with (`config`), and per probe the tool
result as the model reads it (each text content as `textLines`: joined with a line break they are
the bytes) and the requests the engine saw (`sent`, sorted: a call that sends more than one
request starts its reads in parallel, with the Authorization they carried). A boot the server
refuses is the golden instead (`boot`). Ports read `127.0.0.1:<port>`. The golden file sorts
every object's keys, so a `structuredContent` is pinned by its values, not by its key order.

A read that fails ends the tool call, and the call's end cancels the reads it started. So each
probe names its round, the reads the call starts before any answer, and the engine answers none
before they all arrived; whether a parallel read still went out never depends on timing. A
round the call does not fill fails the case after two seconds and names the count to set.

Never edit a golden by hand. An intended change runs
`pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update` (refused in CI) and
commits the diff. The CLI (`apps/cli/test/__golden__/error-paths`) and Pulse for VS Code
(`apps/vscode/test/__golden__/error-paths`) pin the same cases under the same names.

Some texts come from the runtime, not from Pulse: the network codes (ECONNREFUSED, ENOTFOUND,
DEPTH_ZERO_SELF_SIGNED_CERT), the "Invalid character" of `basic-password-euro` (Node's `btoa`)
and the header error of `token-line-break-inside` (undici's `Headers.set`). They are checked with
Node 22.23.4 (CI runs the newest Node 22) and 24.15.0; a Node update that rewords one turns its
golden red without a change in Pulse. `dns-failure` needs a resolver that answers `.invalid` with
NXDOMAIN: offline the lookup fails with EAI_AGAIN, and a resolver that rewrites NXDOMAIN reaches a
real host.

Steps are those of the transport plan (3.1): 10 puts the server on `@miragon/pulse-http`, 12 moves
its engine settings into the profile (the `config` blocks then change with it).

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | 302 to a login page: the redirect target without its query, the advice, nothing followed; for the inspect and a registrar read | none planned |
| `unauthorized-none` | pinned | 401 without a body; the remedy for a server without engine credentials; for the inspect and a registrar read | none planned |
| `unauthorized-basic` | pinned | 401 to Basic `demo`/`demo-secret`, the header as sent | none planned |
| `unauthorized-bearer` | pinned | 401 to a static bearer token | none planned |
| `unauthorized-passthrough` | pinned | 401 to the caller's verified token, forwarded under OAuth | none planned |
| `wrong-rest-root` | pinned | the URL lacks `/engine-rest`: a servlet container's HTML 404 and the root hint; for the inspect and a registrar read | none planned |
| `missing-resource` | pinned | 404 `InvalidRequestException`: the inspect's NOT_FOUND for runtime and history (read by `isMissing`), the variables read's engine message | none planned |
| `engine-text-echoes-secret-basic` | pinned | a 500 whose message echoes the Basic value, the password and a token: the configured password and Basic value read `***`, the text is cut after 500 characters | none planned (the masking must survive 10) |
| `engine-text-echoes-secret-bearer` | pinned | the same message to a static bearer token: the token reads `***`, the rest is no credential of this engine | none planned (the masking must survive 10) |
| `deadline-exceeded` | pinned | `ENGINE_REQUEST_TIMEOUT_MS=300` against an engine that never answers, under `engine:admin`; known bug: the reading POSTs (`engine_create_migration_plan`, the query and counts of the feed `engine_process_instances_data`) warn that they may have applied, like the real write `engine_start_process_instance` | 10 (no write caveat for reading POSTs) |
| `unreachable` | pinned | a closed loopback port: ECONNREFUSED | none planned |
| `tls-failure` | pinned | a self-signed certificate; known bug: the write probe warns that a PUT the handshake stopped may have applied | 10 (no write caveat for TLS) |
| `dns-failure` | pinned | a host under `.invalid`: ENOTFOUND | none planned |
| `too-large-response` | deferred | the server has no size cap today, so only an answer above the coming 64 MiB cap could show a change, and the test would buffer it | 10 (64 MiB cap, then pinned) |
| `basic-password-euro` | pinned | known bug: the boot fails with "Invalid character", naming no variable (Basic is Latin-1) | 10 (boots, Basic as UTF-8) |
| `path-value-dot` | pinned | known bug: `processInstanceId` "." and ".." are resolved away, the reads go to `/process-instance/` and to the REST root | 10 (refused before sending) |
| `double-slash-root` | pinned | known bug: a URL ending in `//` keeps one slash, the reads go to `/engine-rest//…` | 10 (slashes trimmed) |
| `token-line-break-inside` | pinned | known bug: the boot fails with the header error, which echoes the token | 10 (refused without echo) |
| `token-line-break-trailing` | pinned | a trailing line break: the header goes out trimmed already | none planned (10 trims it on purpose) |
| `integer-beyond-2-53` | pinned | known bug: a Long variable 9223372036854775807 reaches the model as 9223372036854776000 | 10, only with E2 (a): exact digits as a string |
