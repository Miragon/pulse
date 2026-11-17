# The C8 adapter

The adapter that reads Camunda 8 for Pulse's questions, on SaaS and Self-Managed, from 8.9 on.

## Why

Camunda 8 has another API than the C7 family, so it gets an adapter of its own that shares no code
with the C7 one. Its reads are its family's core, `@miragon/pulse-c8-core` (the REST client, the
readers, the mappings), over a transport port that carries fields only. The adapter brings the
wire behind that port: it calls the Orchestration Cluster REST API itself through
`@miragon/pulse-http`, the transport the CLI and the MCP server send through, over the global
`fetch` of its host's runtime ([c8-adapter.md](../../../../../apps/vscode/docs/adr/c8-adapter.md)):
no client library and no child process. Its tokens come from the transport's OAuth client.

## How it works

```mermaid
flowchart LR
  root(["composition root"])
  core(["core"])
  subgraph adapter ["c8-adapter"]
    plug["C8Adapter"]
    runtime["C8ProcessRuntime"]
    http["CamundaHttp"]
    wire["wire"]
  end
  subgraph c8core ["c8-core"]
    reader["reader"]
    rest["RestCamundaClient"]
  end
  root -- "1: connection" --> plug
  plug -- "1: runtime" --> runtime
  core -- "2: ask" --> runtime
  runtime -- "2: question" --> reader
  reader -- "3: cluster calls" --> rest
  rest -- "4: requests" --> http
  http -- "4: requests" --> wire
  wire -. "5: token" .-> login[("token endpoint")]
  wire -. "6: REST calls" .-> cluster[("/v2")]
  wire -- "7: text or a reason" --> http
  http -- "7: JSON, text or a failure's fields" --> rest
  rest -- "8: checked views" --> reader
  reader -- "9: read model" --> runtime
  runtime -- "9: answer or RuntimeError" --> core
```

1. A composition root hands `C8Adapter` a connection; `runtime(connection)` builds a `C8ProcessRuntime` over a client of its `CamundaClients`, so every runtime shares the adapter's token sources.
2. The core asks through the `ProcessRuntime` port; the runtime checks the version floor and hands the question to its reader.
3. The reader (c8-core) asks the REST client for what it needs, e.g. "the open incidents of instance X".
4. The REST client turns that into requests to the transport port, which `CamundaHttp` implements over the wire: a GET, a search as a reading POST, or a diagram's XML.
5. With client credentials the wire gets a token from the connection's token source, one per cluster and client.
6. It sends the request on a read-only connection, never follows a redirect, stops after 60 s or 64 MiB.
7. It answers with the text or with a reason, data that names no type of the transport; `CamundaHttp` reads JSON losslessly or throws a `CamundaRequestError`, whose fields (`CamundaFailure`) the port hands c8-core, which reads a missing resource from them.
8. The REST client checks each field it reads.
9. The reader maps the views onto engine-core's read models; `errors` turns a failure into a `RuntimeError` with its way out, which the runtime throws.

## Where things are

- `packages/connectors/c8/c8-adapter/src`: `C8Adapter`, the plug of the ports; `C8ProcessRuntime`, which answers the contract with the readers after the version floor; `CamundaClients`, which builds a client per connection and holds the token sources; `C8BpmnDialect`, the vocabulary of Camunda 8's BPMN files (the one file that imports `zeebe-bpmn-moddle`'s descriptor)
- `packages/connectors/c8/c8-adapter/src/web-ui`: `OperateWebUi`, the links into Operate
- `packages/connectors/c8/c8-adapter/src/wire`: `CamundaWire` over the transport, the token sources and the reasons of each failure
- `packages/connectors/c8/c8-adapter/src/rest`: `CamundaHttp`, c8-core's `CamundaTransport` over the wire, and `CamundaRequestError`, the wire's error with its words and the fields the port copies
- `packages/connectors/c8/c8-adapter/src/errors`: `ErrorTranslation` and `TokenTexts`, from a failure to a `RuntimeError`
- `packages/connectors/c8/c8-core/src`: the REST client (`src/rest`: requests, paging, parsed and checked views), one reader per question (`src/reading`) and the mappings onto engine-core's read models (`src/mapping`)

## Rules

- `packages/connectors/c8/c8-adapter/src` imports only the main entries of engine-core and c8-core, the runtime view's ports, in its BPMN dialect the descriptor of `zeebe-bpmn-moddle` and, in its wire, the main entry and `./oauth` of `@miragon/pulse-http`; no Node built-in, no c7 package (dependency-cruiser)
- Engine words are allowed here, not in contract, core or webview; classes, no comments (ESLint)
- A secret never appears in an error, and a refused token request is not repeated within its hold
- A key that is no Java long names nothing and costs no call; a capped search says so where the contract has room for it (`truncated`, `atLeast`) or keeps the cluster's counts

## More

[C8 adapter](../../../../../apps/vscode/docs/adr/c8-adapter.md) · [code structure](../../../../../apps/vscode/docs/adr/code-structure.md) · [runtime contract](../../../../../apps/vscode/docs/adr/runtime-contract.md)
