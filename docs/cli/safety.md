# Safety

Three guards keep an agent, a script or a tired human from changing more than intended. The core
guide (`pulse guide`) has the same rules in short form.

- **`--dry-run`** prints the request without sending it. It works in read-only mode too.
- **`--yes`**: commands with effect `delete` (delete a resource, resolve an incident) or `bulk`
  (batches, query based updates, all versions of a key) refuse to run without it:

```text
$ pulse process-instance delete abc
{"error":{"code":"CONFIRMATION_REQUIRED","exitCode":2,"message":"`pulse process-instance delete` is a delete operation and needs confirmation","hint":"Re-run with --yes to confirm, or --dry-run to preview."}}
```

- **Read-only mode**: `--read-only`, `PULSE_CLI_READ_ONLY=1` or a profile created with `--read-only`
  refuse every command whose effect is not `read` (exit 2, `READ_ONLY`). Use read-only profiles for
  production engines; a profile guards only the commands that use it, and a URL without
  `--profile` (`--url` or `PULSE_CLI_URL`) [uses none](configuration.md#profiles). When such a URL
  leaves out the `PULSE_CLI_PROFILE` you set, the command warns once on stderr and advises dropping
  that URL. Name the guarded profile without a URL:

```sh
pulse config set prod --url https://camunda.example.com/engine-rest --read-only
pulse process-instance list --profile prod --with-incident
```

- `pulse commands --effect delete` and `pulse commands --effect bulk` list the guarded
  commands.
- `pulse api` normalizes the path before it checks the effect and sends the request
  (`/process-instance/./delete/` is `/process-instance/delete`, a bulk operation that needs
  `--yes`); paths with `#` or `;` are refused.
- A `--url` beside `--profile` keeps a profile of your config file that holds credentials (a secret
  header, Basic auth, OAuth, a bearer token) to the origin of its own URL: another scheme, host or
  port fails (`CONFIG`) before any request, also in a command copied from an editor, and so does
  every `--url` for such a profile without a URL. Drop `--url`, or point the profile at that engine
  with `pulse config set <profile> --url <url>`. A header counts by its name, as masking reads it
  (`Authorization`, `Cookie`, a name with token, secret, password or api-key): the value of another
  one, such as `Ocp-Apim-Subscription-Key`, goes to that `--url`. Beside `--profile`,
  `PULSE_CLI_URL` replaces only the URL and takes every credential of the profile there.
