# Pulse

See what your process engine is running, right next to your BPMN models: definitions,
instances, incidents and variables, with badges on the deployed diagram. Works with Operaton,
CIB seven and Camunda 7.

![Pulse in VS Code: from the engine to its process and an instance with an incident, the expired card fixed in its variables and the retry that clears the incident](https://github.com/Miragon/pulse/raw/main/apps/vscode/docs/demo.gif)

## Why

When an instance gets stuck, you leave the editor: open the engine's web UI, search the
instance, read the stack trace, go back to the code and the model. Pulse brings that view to
where your models and your code already are.

- **The runtime on the model.** Running instances and incidents as badges on the deployed
  diagram, per version.
- **The root cause, not the noise.** The incident's root cause from the full stack trace, with
  links from its frames to your sources.
- **Model and engine side by side.** An open `.bpmn` file tells you whether it matches a
  deployed version.
- **Safe on real engines.** Retries and variable changes run on local engines by default,
  elsewhere only when you allow them, always with a confirmation that names the engine and an
  audit line.

## What you get

- An Engines view in the activity bar, and an engine overview with every process, troubled
  ones first
- A definition panel with the deployed diagram of a version, and an instance panel with where
  it waits, its incidents and its variables
- Show Runtime Data for This Model on a `.bpmn` file, and Go to Process Instance… by id or
  business key
- Boards: shared views as JSON in your repository, counting and listing across engines

## Get started

Pulse reads the engine profiles of `.pulse-cli.json`, the project file of the
[Pulse CLI](https://miragon.github.io/pulse/cli/) (`npx @miragon/pulse-cli`). Mark production
engines with `"pulse.environments": { "<name>": "production" }`. An optional `cockpitUrl` per
profile (a Cockpit ending in `/app/cockpit/<engine>/` or the CIB seven webclient ending in
`/webapp/`) adds an _Open in Cockpit_ button to the panels.

Installation, configuration and usage: [miragon.github.io/pulse/vscode](https://miragon.github.io/pulse/vscode/).
