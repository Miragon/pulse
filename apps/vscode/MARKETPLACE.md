# Pulse

See what your process engine is running, right next to your BPMN models: definitions,
instances, incidents, variables. Retry incidents and fix variables, guarded. Works with
Operaton, CIB seven and Camunda 7.

- **Engines** and **Health** views in the activity bar
- **Engine overview**: every process of an engine with running and incident counts, troubled ones first
- **Definition** panel: the deployed diagram of a version with running and incident badges
- **Instance** panel: where it waits, the root cause of its incidents, its variables
- **Show Runtime Data for This Model** on a `.bpmn` file, with a check against the deployed versions
- **Go to Process Instance…** by id or business key
- **Retry incidents and change variables**: on local engines by default, elsewhere only when you
  allow it in your user settings, always with a confirmation that names the engine and an audit line

Engines come from the profiles of `.operate.json`, the project file of the operate CLI.
Mark production engines with `"pulse.environments": { "<name>": "production" }`.
An optional `cockpitUrl` per profile (a Cockpit ending in `/app/cockpit/<engine>/` or the CIB
seven webclient ending in `/webapp/`) adds an _Open in Cockpit_ button to the panels;
without it there is none.
