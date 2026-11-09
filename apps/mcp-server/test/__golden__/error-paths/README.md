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
commits the diff. The CLI (`apps/cli/test/__golden__/error-paths`) and the C7 adapter of Pulse for
VS Code and Pulse for Orca (`packages/connectors/engine/engine-adapter/test/__golden__/error-paths`)
pin the same cases under the same names.

Some texts come from the runtime, not from Pulse: the network codes (ECONNREFUSED, ENOTFOUND,
DEPTH_ZERO_SELF_SIGNED_CERT). They are checked with Node 22.23.4 (CI runs the newest Node 22) and
24.15.0; a Node update that renames one turns its golden red without a change in Pulse.
`dns-failure` needs a resolver that answers `.invalid` with NXDOMAIN: offline the lookup fails
with EAI_AGAIN, and a resolver that rewrites NXDOMAIN reaches a real host.

Steps are those of the transport plan (3.1): 10 put the server on `@miragon/pulse-http` (the
engine client sends through its transport, the composites through the same client over c7-core's
route table), 12 moves its engine settings into the profile (the `config` blocks then change with
it).

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | 302 to a login page: the redirect target without its query, the advice, nothing followed; for the inspect and a registrar read | none planned |
| `unauthorized-none` | pinned | 401 without a body; the remedy for a server without engine credentials; for the inspect and a registrar read | none planned |
| `unauthorized-basic` | pinned | 401 to Basic `demo`/`demo-secret`, the header as sent | none planned |
| `unauthorized-bearer` | pinned | 401 to a static bearer token | none planned |
| `unauthorized-passthrough` | pinned | 401 to the caller's verified token, forwarded under OAuth | none planned |
| `wrong-rest-root` | pinned | the URL lacks `/engine-rest`: a servlet container's HTML 404 and the root hint; for the inspect and a registrar read | none planned |
| `missing-resource` | pinned | 404 `InvalidRequestException`: the inspect's NOT_FOUND for runtime and history (read by `isMissing`), the variables read's engine message | none planned |
| `engine-text-echoes-secret-basic` | pinned | a 500 whose message echoes the Basic value, the password and a token: the configured password and Basic value read `***`, the text is cut after 500 characters | none planned (the transport masks it since 10) |
| `engine-text-echoes-secret-bearer` | pinned | the same message to a static bearer token: the token reads `***`, the rest is no credential of this engine | none planned (the transport masks it since 10) |
| `deadline-exceeded` | pinned | `ENGINE_REQUEST_TIMEOUT_MS=300` against an engine that never answers, under `engine:admin`: the reading POSTs (`engine_create_migration_plan`, the query and counts of the feed `engine_process_instances_data`) carry no write caveat since step 10 (the route table says they read), the real write `engine_start_process_instance` does | none planned |
| `unreachable` | pinned | a closed loopback port: ECONNREFUSED | none planned |
| `tls-failure` | pinned | a self-signed certificate: the handshake fails before anything is sent, so the write probe carries no write caveat since step 10, and the text says nothing was sent | none planned |
| `dns-failure` | pinned | a host under `.invalid`: ENOTFOUND | none planned |
| `too-large-response` | pinned | an announced Content-Length one byte above 64 MiB: since step 10 the read fails as too large before its body is read, nothing buffered | none planned |
| `basic-password-euro` | pinned | since step 10 the server boots and sends Basic as UTF-8 (RFC 7617), as the CLI and Pulse for VS Code do; it failed the boot with "Invalid character" before (Basic was Latin-1) | none planned |
| `path-value-dot` | pinned | since step 10 `processInstanceId` "." and ".." are refused before sending; before, they were resolved away and the reads went to `/process-instance/` and to the REST root | none planned |
| `double-slash-root` | pinned | since step 10 the slashes at the end of the URL are trimmed, so the reads reach the engine; before, they went to `/engine-rest//…` | none planned |
| `token-line-break-inside` | pinned | since step 10 the boot fails naming the setting, without the token; before, the header error echoed it. Since the profile step the single engine's profile is refused for it, and with no other profile the boot fails naming ENGINE_TOKEN | none planned |
| `token-line-break-trailing` | pinned | a trailing line break: trimmed, the header goes out without it | none planned |
| `integer-beyond-2-53` | pinned | since step 10 (owner decision E2 (a)) a Long variable 9223372036854775807 reaches the model as the string of its exact digits; before, as 9223372036854776000 | none planned |
