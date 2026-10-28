# Output and errors

## Output

stdout carries exactly the engine response, stderr everything else.

- **Format**: JSON when stdout is not a terminal, a table on a terminal. `-o json|table`,
  `PULSE_CLI_OUTPUT` or the profile setting override it. JSON is compact when piped and indented on
  a terminal or with `--pretty`.
- **`--fields id,name,variables.amount`** keeps only these properties (of every element of a
  list); in table format they are the columns.
- **Tables** without `--fields` show the identifying columns first and drop trailing columns to
  fit the terminal (120 characters when piped).
- **No content** (HTTP 204): stdout stays empty, stderr gets
  `Done: <METHOD> <path> → 204 No Content`.
- XML commands (`process-definition xml`, ...) print the raw XML unless `-o json` or `--fields`,
  text responses (`job get-stacktrace`, ...) print raw, binary ones need `--out-file` on a
  terminal. `--out-file <path>` writes the body as received and prints
  `{"outFile", "bytes", "contentType"}`.
- **`--dry-run`** prints the request instead of sending it; `-o table` prints only the `curl`
  command line:

```text
$ pulse-cli process-definition start invoice --var amount=250 --dry-run
{"method":"POST","url":"http://localhost:8080/engine-rest/process-definition/key/invoice/start","headers":{"Accept":"application/json","Content-Type":"application/json"},"body":{"variables":{"amount":{"value":250,"type":"Integer"}}},"curl":"curl -X POST 'http://localhost:8080/engine-rest/process-definition/key/invoice/start' -H 'Accept: application/json' -H 'Content-Type: application/json' --data-raw '{\"variables\":{\"amount\":{\"value\":250,\"type\":\"Integer\"}}}'"}

$ pulse-cli task list --assignee demo --dry-run -o table
curl 'http://localhost:8080/engine-rest/task?assignee=demo' -H 'Accept: application/json'
```

- **`--verbose`** traces the request and response on stderr (secret headers masked):

```text
$ pulse-cli process-definition list --key order-process --fields id,key,version --verbose
> GET http://localhost:8080/engine-rest/process-definition?key=order-process
> Accept: application/json
< 200 OK (14 ms, 408 bytes)
[{"id":"order-process:1:3910b506-c652-11f1-9fc4-1a2aceba9a9d","key":"order-process","version":1}]
```

## Errors and exit codes

Errors go to stderr as one JSON line, the last one; warnings such as a deprecation notice come
before it (`-o table` or a terminal prints readable text). `hint` names the fix (for unknown
commands, options and body properties it starts with "Did you mean ...?"); `engineMessage` carries
the engine's own explanation, also when the engine answers with plain text (such as JSON
deserialization errors).

```text
$ pulse-cli process-instance get abc
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: Process instance with id abc does not exist","status":404,"engineType":"InvalidRequestException","engineMessage":"Process instance with id abc does not exist","hint":"Check the id or key. List the existing ones with `pulse-cli process-instance list`.","request":{"method":"GET","url":"http://localhost:8080/engine-rest/process-instance/abc"}}}

$ pulse-cli process-instance get abc -o table
Error: HTTP 404 Not Found: Process instance with id abc does not exist
  Engine: InvalidRequestException
  Request: GET http://localhost:8080/engine-rest/process-instance/abc
  Hint: Check the id or key. List the existing ones with `pulse-cli process-instance list`.
```

Fields: `code`, `exitCode`, `message`, and when available `status`, `engineType`,
`engineMessage`, `engineCode`, `hint`, `request` (`method`, `url`) and `data` (e.g. the list of
validation problems).

| Exit | Meaning                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------- |
| 0    | success                                                                                                                    |
| 1    | internal error                                                                                                             |
| 2    | usage error, invalid body (`VALIDATION`), `READ_ONLY`, `CONFIRMATION_REQUIRED`                                             |
| 3    | configuration error, also an HTTP redirect (`HTTP_REDIRECT`)                                                               |
| 4    | 401, 403, `LOGIN_FAILED` (the token command failed), `TOKEN_EXPIRED` (a bearer token expired)                              |
| 5    | not found (404)                                                                                                            |
| 6    | other 4xx: the engine rejected the request                                                                                 |
| 7    | engine error (5xx)                                                                                                         |
| 8    | network error or timeout                                                                                                   |
| 9    | expected state not reached (workflow commands): `WAIT_TIMEOUT`, `INCIDENT`, `INSTANCE_ENDED`, `JOB_FAILED`, `CHECK_FAILED` |

Camunda 7 engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already
completed or a deployment that still has running instances. Read `engineMessage` and fix the cause
instead of retrying. A query value the engine cannot read (`maxResults=abc`) comes back as 404
`QueryParamException`; `pulse-cli` reports it as exit 6, not as a missing resource.

`pulse-cli` never follows redirects: a write redirected to a login page must not look successful,
and credential headers must not travel to another host. A 3xx answer is the error `HTTP_REDIRECT`
naming the target; point `--url` at the REST API root itself (e.g. `https://`).
