# Upgrading to 0.26

0.26 renames two result fields, judges `engine_status` by the cockpit's thresholds and reads the
engines more strictly. Settings and tool names stay, and the starter changes little beyond its pins
([A server of your own](upgrading.md#a-server-of-your-own)).

## analytics_engine_health reports metricsState

`analytics_engine_health` returns the state its metrics and alert rules show as `metricsState` and
the rule as `metricsStateRule`, no longer as `status` and `statusRule`; the values stay (`healthy`,
`degraded`, `critical`, `unknown`). A prompt, hook or script that reads the old fields reads
nothing. In `@miragon/pulse-analytics-client`, `EngineHealthResult` carries the new fields and
`ENGINE_HEALTH_STATUS_RULE` is `ENGINE_METRICS_STATE_RULE`.

## engine_status judges by the cockpit's thresholds

`engine_status` is `critical` from `ENGINE_HEALTH_CRITICAL_INCIDENTS` open incidents (default 50) or
`ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE` incidents of one cause (default 25), counted across
definitions, not only on overdue jobs; a critical `INCIDENTS_CRITICAL` finding says why. The
cockpit overview's status is `warning` where it was `degraded` (its badge keeps its words). An alert
on the verdict can fire where it did not.

## Engine URLs and the BPMN lookup

- The server follows no redirect from an engine: a 3xx fails the call and names the target. Point
  every engine URL (`ENGINE_BASE_URL`, each `baseUrl`) at the REST API root itself, `https://`
  included; a redirect to a login page means missing credentials. A 404 of a wrong root fails the
  call instead of reading as "none" (no stacktrace, no batch).
- `createBpmnXmlFetcher`, the lookup `setup.ts` hands analytics, picks its engine like the tools: the
  named one, else `ENGINE_DEFAULT`, else the only engine, else it rejects with `ENGINE_NOT_SELECTED`
  (before: the first configured engine); an unknown id rejects too. `setup.ts` stays as it is; code of
  yours that calls it without an engine id on several engines needs `ENGINE_DEFAULT`.

## Code on the engine and analytics packages

- `@miragon/pulse-engine-client`: `fetchJobStacktrace` and `fetchExternalTaskErrorDetails` reject on
  a 404 instead of resolving `null` (`null` stays for an empty body), and `readBatch` rejects with
  the history read's error. Read a 404 with `isMissing`, which moved from engine-core's `/testing`
  to its main entry. `createEngineClient` rejects a 3xx with an `EngineRequestError`.
- `@miragon/pulse-engine-core`: `/testing` no longer exports `messagePattern` (use
  `messageSignature`) or `engineStatus` (use `engineVerdict`). `readStatus` is `critical` from 50
  open incidents or 25 of one cause; `StatusOptions.thresholds` judges otherwise.
- `@miragon/pulse-analytics-client` exports no `schemas` and has no zod peer: the analytics tools'
  input schemas belong to the connector and are not exported, so code that validated with them
  declares its own zod schema.
