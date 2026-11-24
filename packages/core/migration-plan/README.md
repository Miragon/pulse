# @miragon/pulse-migration-plan

The migration plan file format of Pulse. A plan says how the instances of one BPMN process would
move from one version to another: which element of the source version maps onto which element of
the target version. It is a JSON file in the repository
(`.pulse/migrations/<bpmnProcessId>-v<source>-to-v<target>.migration.json`), versioned and
reviewed like the code. `pulse plan-migration` of the CLI writes it, and Pulse for VS Code
previews it on an engine you pick; this package holds the format, so both read and write the same
file the same way.
Below 1.0: it moves in lockstep with all `@miragon/pulse-*` packages.

## What it is not

No runtime dependency, no file system, no engine: the format imports only its own modules and
parses the text it is handed. Finding, reading and writing the file and asking an engine about the
versions stay with the reader. A plan names no engine, no instance, no tenant, no definition id
and no engine option, and opening one migrates nothing: it holds a process id, two version numbers
and the pairs of element ids, which each engine resolves for itself.

## Install

The package is private: it is not published to npm. The CLI and the editors bundle it from the
workspace (`"@miragon/pulse-migration-plan": "workspace:*"`).

## Minimal example

```ts
import {
  MigrationPlanParser,
  MigrationPlanProblems,
  MigrationPlanText,
  type MigrationPlanNote,
  type MigrationPlanProblem,
} from "@miragon/pulse-migration-plan"

const say = (problem: MigrationPlanProblem | MigrationPlanNote) =>
  console.log(`${problem.path} ${MigrationPlanProblems.describe(problem)}`)
const parsed = MigrationPlanParser.parse(text)
if ("plan" in parsed) {
  console.log(parsed.plan.bpmnProcessId, parsed.plan.mappings.length)
  parsed.notes.forEach(say)
} else {
  parsed.problems.forEach(say)
}

const written = MigrationPlanText.of({
  bpmnProcessId: "invoice",
  source: { version: 1 },
  target: { version: 2 },
  mappings: [{ sourceElementId: "check", targetElementId: "review" }],
})
```

`MigrationPlanParser.parse` never throws: it returns `{ plan, notes }` or `{ problems }`, never
both, and any problem refuses the file. A problem and a note are data, `{ path, code, values }`:
the JSON path it is about (`mappings[2].targetElementId`, or `(file)` for the whole text), a code
from `MigrationPlanProblemCode` and the values its words need. `MigrationPlanProblems.describe`
words it in English, the sentence after the path, so a reader may word the codes in its own
language. What a problem echoes from the file stays short: a key in a path and a `schemaVersion`
text show their first 40 characters, with `…` after a cut, and a `schemaVersion` that is a list
or an object is named by its kind (`a list`, `an object`), never written out.

`MigrationPlanText.of` is the one writer: the keys in their order, two spaces, the mappings sorted
by `sourceElementId` in code-unit order and a last line break. It writes only the keys of a plan,
whatever else the object it is given carries, parses its own text and throws when the parser
refuses it, so no surface writes a file its readers refuse.

## The format

```json
{
  "schemaVersion": 1,
  "bpmnProcessId": "order-fulfillment",
  "source": {
    "version": 3
  },
  "target": {
    "version": 4
  },
  "mappings": [
    {
      "sourceElementId": "Activity_CheckOrder",
      "targetElementId": "Activity_ReviewOrder"
    },
    {
      "sourceElementId": "Activity_Pack",
      "targetElementId": "Activity_Pack"
    },
    {
      "sourceElementId": "Activity_Pack#multiInstanceBody",
      "targetElementId": "Activity_Pack#multiInstanceBody"
    }
  ]
}
```

- `bpmnProcessId`, the id of the process in the BPMN model (the id rule below).
- `source.version` and `target.version`, two different whole numbers from 1 to 2147483647; an
  older target is a plan too. A side holds `version` and nothing else.
- `mappings`, a list of at most 1000 one to one pairs, empty or not, each with exactly a
  `sourceElementId` and a `targetElementId`, each source at most once.
- `schemaVersion` 1, or none, which reads as 1; a `$schema` text, which the parser reads without
  a note.

What the parser refuses and notes, in its order:

- A text longer than 1048576 characters (`tooLarge`), before it is read as JSON; a text that is
  not JSON (`notJson`) or holds no object (`notAnObject`).
- A key of the engine's own plan at the root (`sourceProcessDefinitionId`,
  `targetProcessDefinitionId`, `instructions`, `migrationPlan`: what the generic
  `pulse migration generate-plan --out-file` writes), as `enginePlan` alone, whose words name
  `pulse plan-migration`.
- A `schemaVersion` other than 1, as `unknownVersion` alone, whatever else the file holds.
- A name of `MigrationPlanVocabulary.FOREIGN_KEYS` (`instanceIds`, `tenantId`, `definitionId`,
  `updateEventTriggers`, `skipIoMappings`, `variables` and the rest, keys that name an instance,
  an engine, a tenant, a definition id or an engine option), at the root, in a side or in a
  mapping, as `notInAPlan` and only as that; the parser looks for exactly these names.
- A key a side or a mapping does not know (`unknownKey`), so a key of a newer format never reads
  as nothing.
- A root key it does not know is a note (`ignoredKey`), and so is a `$schema` that is no text
  (`schemaNotText`); Pulse never reads their values, and the plan reads without them.

The parser reads keys with `Object.keys` and builds new objects, so `__proto__` is only a key.

What a plan never holds: instance ids, definition ids or deployment ids, engine or profile names,
URLs, tenant ids, version tags, credentials, variables, timestamps, engine messages or check
results, event trigger and skip flags, instance queries. The writer writes none of them. The
parser refuses an engine's plan, the names in `MigrationPlanVocabulary.FOREIGN_KEYS` at the root,
in a side and in a mapping, and any other key of a side or a mapping; any other root key it only
notes, and Pulse never reads its value.

## The version rule

`schemaVersion` protects an older reader from a newer file. A key that changes what a plan names,
resolves or checks (a tenant, a version tag, a model fingerprint, variables, an instruction of
several elements, event triggers) takes `schemaVersion` 2, and a reader of version 1 refuses that
file: through `unknownKey` inside a side or a mapping, or through `unknownVersion`. A root key that
changes nothing a reader resolves (a title, a note) may join version 1, and an older reader notes
it. A newer reader refusing what an older one accepted is a breaking change of this package, not
a new version.

## The id rule

A process id is a name: a letter or `_` first, then letters, marks, digits, `_`, `.`, `-` or `·`,
at most 255 characters (`MigrationPlanRules.isProcessId`). It holds no `:`, `/`, `\`, `#` or white
space, so a definition id (`invoice:1:def-1`) never passes as one, and the default file path never
leaves `.pulse/migrations`. An element id is such a name, or two joined by one `#`, the scope pair
of a multi-instance element (`Activity_Pack#multiInstanceBody`), each part at most 255 characters
(`MigrationPlanRules.isElementId`). A version is a whole number from 1 to 2147483647
(`MigrationPlanRules.isVersion`).

## The resolution rule

`MigrationPlanVersions.pick(candidates, version)` resolves a version number to a definition of an
engine: `found` with the one candidate that has it, `missing` when none has it, `ambiguous` with
the count when several have it (the same number in several tenants). `only(candidates)` gives the
same three answers for a list that is already narrowed, such as the latest version of each
tenant. A plan has no tenant field, so a number deployed more than once is refused on both sides.
A number deployed again after the latest was deleted means the definition that holds it now;
another model behind the same number on another engine goes unseen, which is why a reader draws
that engine's diagrams and checks the pairs against them.

## The files

`MigrationPlanFiles` holds the convention: `FOLDER` (`.pulse/migrations`), `SUFFIX`
(`.migration.json`), `nameOf(plan)` and `pathOf(plan)` for the default file of a plan, and
`isPlanPath(path)`, whether a path names a plan file: a name before the suffix, with `/` or `\`
between folders.

## The JSON Schema

`schema/migration-plan.schema.json` (`@miragon/pulse-migration-plan/schema/migration-plan.schema.json`)
lets an editor complete and check a plan file. It knows exactly the keys and limits the parser
reads and takes every plan of the fixtures below that the parser reads without a note. It is
looser than the parser on ids, never stricter, and its tests name each difference:

- It refuses what the parser only notes: an unknown root key and a `$schema` that is no text.
- It leaves to the parser: one version twice, one source twice, the cap on the text, the first
  character of an id, the letters and marks an id may hold and the 255 characters of each part
  of an element id.

Pulse for VS Code ships a copy of it for the files in `.pulse/migrations`, held equal by a test.

## Fixtures

`@miragon/pulse-migration-plan/testing` exports `MIGRATION_PLAN_FIXTURES`: each case a plan
file's text, whether the JSON Schema takes it and the parser's verdict as data, the plan with its
notes or every problem of a file that gives no plan. The package's tests run them through the
parser and the schema; a reader of its own runs them through its path.

## Entries

| Entry                                                             | Holds                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-migration-plan`                                   | `MigrationPlanParser`, `MigrationPlanProblems`, `MigrationPlanText`, `MigrationPlanFiles`, `MigrationPlanRules`, `MigrationPlanVersions`, `MigrationPlanVocabulary` and the types of a plan (`MigrationPlanDefinition`), its parse, problems and notes and of a version pick |
| `@miragon/pulse-migration-plan/schema/migration-plan.schema.json` | The JSON Schema of a plan file                                                                                                                                                                                                                                               |
| `@miragon/pulse-migration-plan/testing`                           | `MIGRATION_PLAN_FIXTURES`, the shared fixtures                                                                                                                                                                                                                               |

## Who uses it

- The CLI: `pulse plan-migration` (`apps/cli/src/workflow/`) checks its arguments with the id and
  version rules, resolves each version number with `MigrationPlanVersions` and writes the file
  with `MigrationPlanText`.
- Pulse for VS Code: the runtime view's migration plan preview
  (`packages/core/runtime-view/src/core/plans`) parses the file, words its problems with
  `MigrationPlanProblems` and resolves the versions on the engine you pick with
  `MigrationPlanVersions`; the extension ships the JSON Schema for the editor.

The dependency rules hold the readers to those two places (`migration-plan-consumers`) and the
format to its own modules (`migration-plan-is-a-leaf`); the reasons are in
`apps/vscode/docs/adr/migrations.md`.

## Stability

Below 1.0 the format has no stability promise beyond the release train: a change that makes a
file valid today refused tomorrow is a breaking change and says so in its changelog entry (the
version rule above).

## Help and feedback

- **Bugs and ideas:** found a bug or missing something?
  [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in
[CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md).

### Style

The house rules of Pulse for VS Code, as in `@miragon/pulse-board`: classes, not module
functions, no comments, complexity 10, 300 lines per file (400 for a test file), 60 per function,
no engine word such as a vendor's name anywhere in it, counts in plain digits. The repository's
ESLint config holds the package to them, and its coverage floors are 100.

## Licence

[MIT](LICENSE)
