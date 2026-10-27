# Pulse

See what your process engine is running, right next to your BPMN models: definitions,
instances, incidents, variables. Retry incidents and fix variables, guarded. Works with
Operaton, CIB seven and Camunda 7.

![Pulse in VS Code: from the engine to its process and an instance with an incident, the expired card fixed in its variables and the retry that clears the incident](https://github.com/Miragon/pulse/raw/main/apps/vscode/docs/demo.gif)

- **Engines** view in the activity bar
- **Engine overview**: every process of an engine with running and incident counts, troubled ones first
- **Definition** panel: the deployed diagram of a version with running and incident badges
- **Instance** panel: where it waits, the root cause of its incidents, its variables
- **Show Runtime Data for This Model** on a `.bpmn` file, with a check against the deployed versions
- **Go to Process Instance…** by id or business key
- **Retry incidents and change variables**: on local engines by default, elsewhere only when you
  allow it in your user settings, always with a confirmation that names the engine and an audit line

![The engine overview: every process of the engine with its latest version, running instances and instances with an incident](https://github.com/Miragon/pulse/raw/main/apps/vscode/docs/screenshots/28-engine-overview.png)

![An instance with an incident: the diagram shows where it failed, the incident names its root cause with buttons to the stacktrace, the model, the code and a retry](https://github.com/Miragon/pulse/raw/main/apps/vscode/docs/screenshots/05-instance-incident-root-cause.png)

![Runtime data for a local model: the deployed diagram with incident and instance badges, and a warning that the local file differs from every deployed version](https://github.com/Miragon/pulse/raw/main/apps/vscode/docs/screenshots/17-model-drift.png)

Engines come from the profiles of `.pulse-cli.json`, the project file of the Pulse CLI
(`npx @miragon/pulse-cli`).
Mark production engines with `"pulse.environments": { "<name>": "production" }`.
An optional `cockpitUrl` per profile (a Cockpit ending in `/app/cockpit/<engine>/` or the CIB
seven webclient ending in `/webapp/`) adds an _Open in Cockpit_ button to the panels;
without it there is none.
