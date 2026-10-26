# Architecture decision records

Living topic records, one file per topic, in the style of the BPMN modeler
(`Miragon/bpmn-modeler/docs/adr`). Each record has **Context**, **Decision** and
**Consequences**, a status and a "last reviewed" date. When a change moves a package
boundary, the contract, a dependency or the protocol, update the record in the same
commit and replace superseded text; Git keeps the history.

| Record                                     | Topic                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Packages, dependency rules, composition root, host ⇄ webview protocol              |
| [runtime-contract.md](runtime-contract.md) | The engine-neutral ports, their laws and the conformance kit                       |
| [c7-adapter.md](c7-adapter.md)             | The Camunda 7 family adapter on top of Miragon's engine CLI                        |
| [writes.md](writes.md)                     | Guarded writes: who may write, confirmation, intents, feedback, audit, bulk cancel |
| [migrations.md](migrations.md)             | Migrating instances to another version: plan, checks, batch, failures              |
| [user-interface.md](user-interface.md)     | Information architecture, design tokens, naming, scope of v0.1                     |
| [code-structure.md](code-structure.md)     | Classes implement the ports, one class per file, utility classes per topic         |
| [local-sources.md](local-sources.md)       | Local model and code next to an incident: ports, model adapter, opening            |
| [live-updates.md](live-updates.md)         | Views that read the engine again on their own: cadence, gating, safety             |
| [boards.md](boards.md)                     | Boards: shared JSON views across engines, read only                                |
| [guardrails.md](guardrails.md)             | The machine-checked rules that enforce all of the above                            |

The records were decided in a consensus round of five independent reviews
(architecture, sibling conventions, engine data, lean toolchain, UX) on 2026-10-21;
the decision log is summarised in each record.
