# @miragon/pulse-engine-core

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-core?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-engine-core)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The workflow domain of the Camunda 7 REST API family (Operaton, CIB seven, Camunda 7): where a
process instance waits and why, how an engine is doing, and what retry and advance would send.
It runs on an engine port you implement and returns data.

## Who uses it

[pulse-cli](https://www.npmjs.com/package/@miragon/pulse-cli) bundles it: `inspect`, `status`,
`wait`, `advance` and `retry` run on it and word its results as command lines and CLI errors.
[@miragon/pulse-camunda7-connector](https://www.npmjs.com/package/@miragon/pulse-camunda7-connector)
runs inspect and status on it over its client, as the MCP tools `camunda7_inspect_process_instance`
and `camunda7_engine_status`.
It is the shared domain of every Pulse interface to this API family, so an MCP tool and a CLI
command answer the same question by the same rules.

One port per API family: the vendors differ in runtime configuration, never in this package.

## What it is not

No HTTP, no authentication and no runtime dependency: it imports only its own modules. It names
no command, flag or tool: next steps are structured (`{ action: "retry", processInstanceId }`),
errors are `WorkflowError`s with a `reason` (`{ kind: "selection-ambiguous", candidates, more }`),
and the caller words both. The English texts that describe the engine's state are the package's
and shared by every caller: the finding messages of the status triage, its truncation notes and
the summaries of planned writes (`execute job j1`).

## Install

```sh
npm install @miragon/pulse-engine-core
```

## The API in brief

- **Port:** `createEnginePort(transport)` turns your `EngineTransport` (send an operation by its
  REST operation id, read an answer as JSON or text, read an engine failure) into the
  `EnginePort` the workflows run on, with the shared read rules: pages of 500, a missing resource
  as undefined, blank texts as undefined. A missing resource is an engine 404 whose exception type
  is neither `NotFoundException` (no such endpoint, a wrong REST root) nor `QueryParamException`,
  so your `failure` reading must carry the engine's `engineType`: without it a missing instance
  fails instead of reading as missing.
- **Inspect:** `inspectInstance(port, selection, options)` selects an instance by id, by business
  key or by key with `latest`, and loads its view: wait states with their ids, root-cause
  incidents, called instances, optionally variables, the history timeline and stacktraces.
- **Status:** `readStatus({ port, now }, options)` triages one engine: findings with severity, the
  overall status, definitions, incident groups with their root cause, topics, jobs and batches,
  every cut named in `truncated`.
- **Plans:** the pure parts of retry (`planRetry`, `retriesWrite`), advance (`chooseWait`,
  `advanceSteps`) and wait (`parseCondition`, `decide`, `poll`).

```ts
import { createEnginePort, type EngineTransport, inspectInstance } from "@miragon/pulse-engine-core"

// Your client's answer of one request, read right after it arrived.
type Answer = { readonly body?: unknown; readonly text?: string }

const transport: EngineTransport<Answer> = {
  send: (operationId, input) => yourClient.send(operationId, input),
  json: (answer) => answer.body,
  text: (answer) => answer.text,
  failure: (error) =>
    error instanceof YourHttpError
      ? { status: error.status, engineType: error.type, engineMessage: error.message }
      : undefined,
}
const port = createEnginePort(transport)
const view = await inspectInstance(
  port,
  { businessKey: "B-1", latest: true },
  { variables: true, history: false, stacktrace: false },
)
```

## Testing helpers

`@miragon/pulse-engine-core/testing` exports the verified workflow fixture, the status fixture,
wait states of every kind, `fakePort` (a recording port over canned answers that refuses any
operation without a route) and `fakeClock`. It also exports the rules behind the entry's
functions that tests reach directly, and `INSPECT_OPERATIONS` and `STATUS_OPERATIONS`, the
operations each composite sends: a port that maps operations one by one holds its table equal to
them in a test.
