# Engines

pulse-cli works with Operaton, CIB seven and Camunda 7. All three speak the Camunda 7 REST API. Each
has its own adapter in pulse-cli, so a difference of one engine stays in one place.

## Compatibility

| Engine    | `platform` | Tested in CI with                         |
| --------- | ---------- | ----------------------------------------- |
| Operaton  | `operaton` | `operaton/operaton:2.1.5`                 |
| CIB seven | `cibseven` | `cibseven/cibseven:run-2.2.0`             |
| Camunda 7 | `camunda7` | `camunda/camunda-bpm-platform:run-7.24.0` |

Commands for features an engine does not offer fail with the engine's error. Property names that
differ between the engines are both accepted (`operatonFormRef`, `camundaFormRef`). Camunda 8 is
not supported: it has a different API (see the [decision](adr/002-camunda-8-is-a-separate-api.md)).

## Choosing the engine

Set `platform` in a profile, `PULSE_CLI_PLATFORM` or `--platform`. Without it pulse-cli uses
`camunda7`, which works for all three engines today.

```sh
pulse-cli config set local --platform operaton
pulse-cli ping --platform cibseven
```

`platform` is the product. `engine` is the name of a process engine on that server
(`/engine/{name}`). See [Configuration](configuration.md#engines).

## Known differences

None that pulse-cli has to handle today. The engine patches in `apps/cli/spec/engines/` are empty,
and the three generated catalogs are identical.

## Adding a difference

1. Describe it as an RFC 6902 patch in `apps/cli/spec/engines/<engine>.patches.json`, with a
   `test` guard and a `reason`.
2. Run `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`. Only
   `apps/cli/src/generated/catalog.<engine>.json` changes.
3. Take that engine out of the test that keeps the catalogs identical
   (`apps/cli/scripts/catalog/render.test.ts`).
4. If the difference is in behaviour, not in the API description, wrap the port in
   `apps/cli/src/engines/<engine>/adapter.ts`.

## Adding an engine

1. Add its name to `PLATFORMS` (`apps/cli/src/config/types.ts`) and to `ENGINES`
   (`apps/cli/scripts/catalog/files.ts`).
2. Create `apps/cli/spec/engines/<engine>.patches.json` with `[]` and run
   `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`.
3. Write `apps/cli/src/engines/<engine>/adapter.ts` on the API it speaks and add it to
   `apps/cli/src/engines/index.ts`.
4. Add a container to the engine suites (`apps/cli/test/integration/support/engines.ts`).

An engine with another API gets its own folder in `apps/cli/src/api/` first.
