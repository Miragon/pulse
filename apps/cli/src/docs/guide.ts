/**
 * The usage guide for LLM agents: the core printed by `operate guide` and the topic
 * pages printed by `operate guide <topic>` (src/docs/guide-topics). `skills/pulse-cli/SKILL.md` is
 * a YAML frontmatter followed by exactly the core, which ends with the index of the topics. Every
 * `operate` command line in the code blocks of every page is checked against the catalog and run in
 * the CLI; unit tests keep all of it true. Markdown, formatted with Prettier.
 */

import { closeNames } from "../util.js"
import { AUTH_TOPIC } from "./guide-topics/auth.js"
import { CONFIG_TOPIC } from "./guide-topics/config.js"
import { INPUT_TOPIC } from "./guide-topics/input.js"
import { OUTPUT_TOPIC } from "./guide-topics/output.js"
import { RECIPES_TOPIC } from "./guide-topics/recipes.js"
import type { GuideTopic } from "./guide-topics/topic.js"
import { WORKFLOW_TOPIC } from "./guide-topics/workflow.js"

/** The topics of `operate guide <topic>`, in the order of the index. */
export const GUIDE_TOPICS: readonly GuideTopic[] = [
  WORKFLOW_TOPIC,
  INPUT_TOPIC,
  OUTPUT_TOPIC,
  CONFIG_TOPIC,
  AUTH_TOPIC,
  RECIPES_TOPIC,
]

/** Shorter words match too many summaries to be worth a suggestion. */
const MIN_SEARCH_LENGTH = 3

/** The topic of a name. */
export function findGuideTopic(name: string): GuideTopic | undefined {
  return GUIDE_TOPICS.find((topic) => topic.name === name)
}

/**
 * Topics for an unknown topic name: close spellings (`oauth` → `auth`), else the topics whose name
 * or summary contains the word (`bearer` → `auth`, `variables` → `input`).
 */
export function topicSuggestions(word: string): string[] {
  const names = GUIDE_TOPICS.map((topic) => topic.name)
  const close = closeNames(word, names)
  if (close.length > 0 || word.length < MIN_SEARCH_LENGTH) return close
  const wanted = word.toLowerCase()
  return GUIDE_TOPICS.filter((topic) =>
    `${topic.name} ${topic.summary}`.toLowerCase().includes(wanted),
  ).map((topic) => topic.name)
}

const TOPIC_INDEX = GUIDE_TOPICS.map((topic) => `- \`${topic.name}\`: ${topic.summary}`).join("\n")

export const GUIDE = `# operate: the Camunda 7 REST API from the command line

\`operate\` calls the REST API (\`/engine-rest\`) of Camunda 7 process engines: Operaton, CIB seven and
Camunda 7 CE/EE. Every REST operation is a command generated from the OpenAPI spec:
\`operate <group> <command> [path-args...] [options]\`; workflow commands such as \`operate inspect\`
combine several requests. It never prompts, prints JSON when stdout is not a terminal, reports
errors as one JSON line on stderr and uses stable exit codes. This core guide covers everyday use;
\`operate guide <topic>\` prints the details of a topic (see Topics at the end).

## Setup

If \`operate\` is missing, run \`npx -y @miragon/operate\` in its place or ask the user to install it
with \`npm i -g @miragon/operate\` (Node.js 22.12+). The REST API root defaults to
\`http://localhost:8080/engine-rest\`. Set it per shell, then check the connection:

\`\`\`sh
export OPERATE_URL=http://localhost:8080/engine-rest
operate ping
\`\`\`

A repository may ship its engines as profiles in a project file (\`.operate.json\`): check
\`operate config list\` first (scope \`project\`), a bare \`operate ping\` then uses its default.

Or keep each engine in a profile and pick one with \`--profile\`. \`--url\` and \`OPERATE_URL\` override
the URL of every profile (and its credentials go along), so unset \`OPERATE_URL\` first:

\`\`\`sh
unset OPERATE_URL
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate ping --profile prod
\`\`\`

- \`operate ping\` prints \`{url, engine, reachable, version, engines, latencyMs, auth}\` (\`user\` too).
- Precedence for every setting: flag > environment variable > profile > default.
- Links to Cockpit: take \`values.cockpitUrl\` from \`operate config show -o json\`; when it is null,
  ask the user for the Cockpit URL instead of guessing it from the engine URL.
- Profiles, project files, environment variables, named engines and headers:
  \`operate guide config\`. Basic auth, bearer tokens, token commands and OAuth logins:
  \`operate guide auth\`.

## Discover, describe, preview, run

Never guess commands or flags. Look them up, preview writes, then run:

\`\`\`sh
operate commands
operate commands --search incident
operate describe process-definition start
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
\`\`\`

- \`operate commands\` lists the groups (and \`workflow\`); \`operate commands <group>\` the commands of
  a group with method, path, effect and summary; \`--search\` finds commands whose command, alias,
  operationId, summary or path contain every word (\`--search 'process instance'\`); \`--effect\`
  filters by \`read\`, \`write\`, \`delete\` or \`bulk\`.
- \`operate describe <group> <command>\` (or an operationId or workflow command) shows arguments,
  options, the request body schema, responses and examples (JSON when piped, text with \`-o table\`).
- \`operate <group> <command> --help\` shows the options; \`operate guide\` prints this guide.

## Workflow commands

Top-level commands that combine requests, so no id passes through you. They select an instance by
id, \`--business-key\` or \`--process-definition-key <key> --latest\`; \`next\` lists follow-ups:

- \`operate inspect\`: where an instance waits and why: wait states, root incidents, variables.
- \`operate wait\`: until the instance is idle, or \`--until ended|incident|task[:key]|activity:<id>\`.
- \`operate advance\`: completes what it waits for: user or external task, message, timer, job.
- \`operate retry\`: sets the retries behind open incidents; \`--now\` executes the jobs.
- \`operate deploy\`: deploys changed files and directories, reports the versions in effect.
- \`operate status\`: grouped incidents with root cause, overdue jobs, external task workers.

\`\`\`sh
operate deploy bpmn --start --business-key B-1 --var amount=250
operate inspect --business-key B-1
operate advance --business-key B-1 --var approved=true --wait
operate retry --business-key B-1 --now
operate wait --business-key B-1 --until ended
operate status
\`\`\`

Use \`operate wait\` or \`--wait\` (advance, retry, deploy) instead of \`sleep\`; it fails on incidents
with exit code 9, which still prints the view. Options and rules: \`operate guide workflow\`.

## Invocation conventions

- Path parameters are positional arguments in path order; query parameters and body properties are
  kebab-case flags (\`businessKey\` → \`--business-key\`); global options work after the command.
- Variables: \`--var name=value\`, repeatable and auto typed; force a type with \`name:Type=value\`,
  e.g. \`--var zip:String=01234\`.
- \`--body <json>\`, \`--body @file.json\` or \`--body -\` (stdin) is the base JSON body for nested
  structures; flags are merged on top, and the body is validated against the API schema.
- List commands with \`--max-results\` also take \`--all\` to fetch every page.
- Booleans, arrays, dates, variable types, files and the global options: \`operate guide input\`.

## Output

- stdout carries exactly the engine response (workflow commands: their view): JSON, compact when
  piped, indented on a terminal or with \`--pretty\`, always ending with a newline.
- \`--fields id,name,variables.amount\` keeps only these properties; \`-o table\` prints a table.
- No content (HTTP 204): stdout stays empty, stderr gets \`Done: <METHOD> <path> → 204 No Content\`.
- XML, text and binary responses, \`--out-file\`, \`--dry-run\` and \`--verbose\`: \`operate guide output\`.

## Errors and exit codes

Errors are one JSON line on stderr (\`-o table\` prints readable text instead):

\`\`\`text
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: ...","status":404,"engineType":"InvalidRequestException","hint":"...","request":{"method":"GET","url":"..."}}}
\`\`\`

| exit | meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | success                                                                                                |
| 1    | internal error                                                                                         |
| 2    | usage error, invalid body (\`VALIDATION\`), \`READ_ONLY\`, \`CONFIRMATION_REQUIRED\`                         |
| 3    | configuration error, also an HTTP redirect (\`HTTP_REDIRECT\`, see below)                                |
| 4    | auth failed: 401, 403, \`LOGIN_REQUIRED\` (a person must log in), \`LOGIN_FAILED\`, \`TOKEN_EXPIRED\`        |
| 5    | not found (404)                                                                                        |
| 6    | other 4xx: the engine rejected the request, read \`engineMessage\`                                       |
| 7    | engine error (5xx)                                                                                     |
| 8    | network error or timeout                                                                               |
| 9    | expected state not reached: \`WAIT_TIMEOUT\`, \`INCIDENT\`, \`INSTANCE_ENDED\`, \`JOB_FAILED\`, \`CHECK_FAILED\` |

Read \`hint\` first: it names the fix (\`operate describe ...\`, \`--yes\`, \`--no-validate\`, the
accepted date forms, ...); for unknown names it starts with "Did you mean ...?". Redirects are never
followed: a 3xx answer is \`HTTP_REDIRECT\` (exit 3), fix \`--url\` (\`https\`, a login page). Camunda 7
engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already claimed:
read \`engineMessage\` and fix the cause instead of retrying. On exit 4: \`operate guide auth\`.

## Safety

- \`--dry-run\` prints the request (\`method\`, \`url\`, \`headers\`, \`body\`, \`curl\`) without sending it.
  Use it before writes you are unsure about; it works in read-only mode too.
- Commands with effect \`delete\` or \`bulk\` (batches, query based updates, all versions of a key,
  \`operate retry --process-definition-key\` alone) refuse to run without \`--yes\` (exit 2,
  \`CONFIRMATION_REQUIRED\`). Add \`--yes\` only when the user asked for exactly that change.
- \`--read-only\`, \`OPERATE_READ_ONLY=1\` or a profile created with \`--read-only\` refuse every
  command whose effect is not \`read\` (exit 2, \`READ_ONLY\`). Use read-only profiles for production.

## Topics

\`operate guide <topic>\` prints the details of a topic; \`operate guide --list\` lists the topics:

${TOPIC_INDEX}

\`\`\`sh
operate guide --list
operate guide recipes
\`\`\`

An older operate without topics answers "Too many arguments for 'guide'": run
\`npx -y @miragon/operate@latest guide <topic>\` instead, or ask the user to update operate.
`
