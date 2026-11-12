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
  leaves out the `PULSE_CLI_PROFILE` you set, the command warns once on stderr and names the
  `--profile` that keeps it:

```sh
pulse config set prod --url https://camunda.example.com/engine-rest --read-only
pulse process-instance list --profile prod --with-incident
```

- `pulse commands --effect delete` and `pulse commands --effect bulk` list the guarded
  commands.
- `pulse api` normalizes the path before it checks the effect and sends the request
  (`/process-instance/./delete/` is `/process-instance/delete`, a bulk operation that needs
  `--yes`); paths with `#` or `;` are refused.
