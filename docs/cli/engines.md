# Engines

pulse-cli works with Operaton, CIB seven and Camunda 7. All three speak the Camunda 7 REST API. Each
has its own adapter in pulse-cli, so a difference of one engine stays in one place.

## Compatibility

| Engine    | `flavor`   | Tested in CI with                         |
| --------- | ---------- | ----------------------------------------- |
| Operaton  | `operaton` | `operaton/operaton:2.1.5`                 |
| CIB seven | `cibseven` | `cibseven/cibseven:run-2.2.0`             |
| Camunda 7 | `camunda7` | `camunda/camunda-bpm-platform:run-7.24.0` |

Commands for features an engine does not offer fail with the engine's error. Property names that
differ between the engines are both accepted (`operatonFormRef`, `camundaFormRef`). Camunda 8 is
not supported: it has a different API (see the [decision](adr/002-camunda-8-is-a-separate-api.md)).

## Choosing the engine

Set `flavor` in a profile, `PULSE_CLI_FLAVOR` or `--flavor`. Without it pulse-cli uses
`camunda7`, which works for all three engines today.

```sh
pulse-cli config set local --flavor operaton
pulse-cli ping --flavor cibseven
```

`flavor` is the product. `engine` is the name of a process engine on that server
(`/engine/{name}`). See [Configuration](configuration.md#engines).

## Known differences

None that pulse-cli has to handle today, so every adapter reads the same generated catalog,
`apps/cli/src/generated/catalog.json`.

## Adding a difference

1. If the API description differs, give that engine a catalog of its own: an RFC 6902 patch with a
   `test` guard and a `reason`, applied after `apps/cli/spec/camunda7-rest/patches.json` by
   `apps/cli/scripts/generate-catalog.ts`, and read by that engine's adapter only.
2. If the behaviour differs, wrap the port in `apps/cli/src/engines/<engine>/adapter.ts`.

## Adding an engine

1. Add its name to `FLAVORS` (`apps/cli/src/config/types.ts`).
2. Write `apps/cli/src/engines/<engine>/adapter.ts` on the API it speaks and add it to
   `apps/cli/src/engines/index.ts`.
3. Add a container to the engine suites (`apps/cli/test/integration/support/engines.ts`).

An engine with another API gets its own folder in `apps/cli/src/api/` first.
