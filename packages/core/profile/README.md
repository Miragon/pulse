# @miragon/pulse-profile

[![npm](https://img.shields.io/npm/v/@miragon/pulse-profile?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-profile)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

One profile format for the engines Pulse reaches: the file a repository shares with its team, the
config file of the [Pulse CLI](https://www.npmjs.com/package/@miragon/pulse-cli), the project
files Pulse for VS Code finds in a workspace and the profiles of a Pulse MCP server. This package
holds the format: a parser that takes the text of a profile file and returns a verdict per
profile as data, the JSON Schema for your editor, and the shared fixtures every reader tests
against. So a profile means the same in every Pulse client, and each refuses the same mistakes.

## What it is not

No runtime dependency, no file system, no environment: it imports only its own modules and parses
the text it is handed. Finding and reading the file, resolving a secret from its variable, saying
what follows from a verdict (a failed command, a problem in the editor, a boot warning) and every
way out (a flag, a variable, a command) stay with the reader. A verdict carries a code and the key
it is about, never a value of the file: a value may be a credential pasted into the wrong place.

## Install

```sh
npm install @miragon/pulse-profile
```

## The format

```json
{
  "$schema": "https://unpkg.com/@miragon/pulse-profile/schema/pulse.schema.json",
  "defaultProfile": "local",
  "profiles": {
    "local": { "url": "http://localhost:8080/engine-rest", "flavor": "cibseven" },
    "staging": {
      "url": "https://staging.example.com/engine-rest",
      "environment": "staging",
      "readOnly": true,
      "auth": { "type": "basic", "username": "ci" }
    }
  }
}
```

A profile's name is how you select it, and on an MCP server the engine id. Its keys: `url` (the
REST API root), `cockpitUrl` (the engine's web app, for links), `engine` (a named process engine),
`flavor` (`camunda7`, `cibseven` or `operaton`, each mapped to the API dialect it speaks in
`FLAVORS`), `environment`, `auth`, `output`, `timeout`, `headers` and `readOnly`. `auth.type` is
`none`, `basic`, `bearer`, `oauth` or `passthrough` (an MCP server forwards its caller's token).

Where a file comes from decides what it may hold of credentials, the `credentials` policy you
parse it under:

| Policy           | The file                                   | A secret itself | The variable that holds it            |
| ---------------- | ------------------------------------------ | --------------- | ------------------------------------- |
| `none`           | a file others share, such as `.pulse.json` | refused         | refused                               |
| `env`            | the profiles of an MCP server              | refused         | only one that starts `ENGINE_SECRET_` |
| `env-or-literal` | your own config file of the CLI            | allowed         | allowed                               |

Only text that gives no profiles fails the file: invalid JSON (with its line and column), a root
or a `profiles` that is no object, a root key twice. Anything else refuses the one profile it
concerns (an unknown key, a value of the wrong shape, a key or a name twice, a header name twice
in any spelling, a URL with credentials, a credential the policy refuses), and what is off at the
root besides the profiles is a note: the file still loads. The parser reads the keys in the order
of the text, so a name of digits keeps its place and a second `"readOnly": false` never wins
silently.

## The API in brief

```ts
import { describeProblem, parseProfileFile, refusalsOn, type Surface } from "@miragon/pulse-profile"

const SERVES: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "bearer"],
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}

const file = parseProfileFile(text, { credentials: "none" })
for (const verdict of file.profiles) {
  const problems = verdict.profile ? refusalsOn(verdict.profile, SERVES) : verdict.problems
  for (const problem of problems) console.warn(verdict.name, describeProblem(problem))
}
```

- **Parser:** `parseProfileFile(text, { credentials })` returns a `ProfileFile`: `problem` when
  the file gives no profiles, `notes`, `defaultProfile` and a `ProfileVerdict` per profile (its
  name, its position, its `problems` and, without problems, the checked `profile`).
  `defaultProfileOf(file)` is the profile to use when none is named: `defaultProfile`, else the
  only profile; a `defaultProfile` that is off never falls back.
- **Readers:** `Surface` states what a reader serves; `refusalsOn(profile, surface)` lists what it
  cannot (a dialect, an auth type, a missing `url`, a named process engine, a key such as
  `headers`), so a key is applied or refuses the profile, never ignored. `dialectOf` and
  `authTypeOf` give what a profile uses.
- **Rules a reader applies elsewhere too:** `urlProblem`, `normalizeUrl` and
  `normalizeCockpitUrl` for a URL from a flag or a variable, `isLoopbackHost` and
  `credentialsInClearText` (a credential over plain http beyond the local machine),
  `isHeaderName`, `isHeaderValue`, `isSecretHeader`, the value rules `isUsername`, `isEngineName`,
  `isTimeout`, `isScopeList` and `isRedirectPort` (for a value a flag or a variable sets instead),
  `isConventionalVariable` (a variable name a message may show), `jsonErrorPosition`.
- **Wording:** `describeProblem(problem)` is one English sentence that names the key and never a
  value, a variable or a profile name; put your context in front and your way out behind.

## JSON Schema

`@miragon/pulse-profile/schema/pulse.schema.json`, also at the URL of `$schema` above. It is never
stricter than the parser: what the parser takes silently under any policy, the schema takes too.
What JSON Schema cannot see (where the file comes from, a key twice, a URL's details, a default
that names no profile) only the parser refuses.

## Testing helpers

`@miragon/pulse-profile/testing` exports `PROFILE_FIXTURES`, one fixture per accepted and refused
case with its verdict under every policy and whether the schema takes it, and `outcomeOf`, the
form a reader's test compares a `ProfileFile` in. A reader runs the fixtures through its own path
and keeps what it makes of each verdict next to its tests.
