# Architecture decisions

These records describe the architecture of operate as it is today, as a set of decisions: what was
decided, what follows from it, and which alternatives were turned down and why. They are not a
history. When a decision changes, its record is edited in place so that it stays true.

Change a record in the same pull request that changes what it describes. Every record has the same
sections: Context, Decision, Consequences, Rejected alternatives.

1. [Engines as adapters, the API as its own folder](001-engines-as-adapters.md): one adapter per
   engine behind one port, shared code per API.
2. [Camunda 8 is a separate API](002-camunda-8-is-a-separate-api.md): why Camunda 8 would be a new
   API with its own adapter, not a fourth engine of the Camunda 7 REST API.
