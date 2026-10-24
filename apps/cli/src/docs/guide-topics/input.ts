/** `pulse-cli guide input`: how command lines become requests. */

import { DEFAULT_PAGE_SIZE } from "../../catalog/rules.js"
import type { GuideTopic } from "./topic.js"

export const INPUT_TOPIC: GuideTopic = {
  name: "input",
  summary: "Arguments, flags, booleans, arrays, dates, variables, request bodies, files, paging",
  text: `# pulse-cli guide input: arguments, options, variables and request bodies

How command lines become requests. \`pulse-cli describe <group> <command>\` shows the arguments,
options and request body schema of one command.

## Arguments and options

- Path parameters are positional arguments in path order:
  \`pulse-cli process-instance get-variable <id> <var-name>\`.
- Query parameters and body properties are kebab-case flags: \`businessKey\` → \`--business-key\`.
  Integers, numbers and enums are checked before sending.
- Booleans: \`--with-incident\` sends \`true\`, \`--no-with-incident\` sends \`false\`. Filters the engine
  only applies when true (\`--active\`, \`--unfinished\`, ...) have no \`--no-\` form; parameters whose
  name starts with "no" are a single flag (\`job list --no-retries-left\`).
- Arrays: comma separated or repeated, \`--process-instance-ids a,b --process-instance-ids c\`.
- Dates (date-time options and \`Date\` variables) accept \`2024-05-01\`, \`2024-05-01T10:00\`,
  \`2024-05-01T10:00:00Z\`, \`2024-05-01T10:00:00.000+02:00\` and the engine format
  \`2024-05-01T10:00:00.000+0200\`. Times without an offset are UTC.
- List commands with \`--max-results\` also take \`--all\`: fetch every page (page size
  \`--max-results\`, default ${DEFAULT_PAGE_SIZE}) and print one list.

\`\`\`sh
pulse-cli process-instance list --with-incident --fields id,businessKey,definitionId -o table
pulse-cli task list --candidate-group accounting --created-after 2024-05-01T10:00
pulse-cli process-instance list --process-definition-key invoice --all --fields id,businessKey
\`\`\`

## Variables

- \`--var name=value\`, repeatable. Auto typing: \`true\`/\`false\` → Boolean, integers → Integer or
  Long, decimals → Double, \`null\` → Null, anything else → String. Force a type with
  \`name:Type=value\` (String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, Null), e.g.
  \`--var zip:String=01234\`.
- Other variable maps have their own flags: \`--local-var\`, \`--correlation-key\`,
  \`--local-correlation-key\`, \`--triggered-scope-var\`.
- Single variable commands (\`process-instance set-variable\`, \`task-variable set\`, ...) take
  \`--value <raw>\` and \`--type <Type>\`; without \`--type\` the value is auto typed like \`--var\`.

\`\`\`sh
pulse-cli process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
pulse-cli process-instance set-variable $INSTANCE_ID dueDate --value 2024-06-01T12:00 --type Date
\`\`\`

## Request bodies

- \`--body <json>\`, \`--body @file.json\` or \`--body -\` (stdin) is the base JSON body; flags are
  merged on top (flags win, \`--var\` entries win per name). Use it for nested structures such as
  start instructions, topics or sorting.
- The final body is validated against the API schema before sending; \`--no-validate\` skips that.
  A \`VALIDATION\` error (exit 2) lists the problems, with "did you mean" for misspelled properties.

\`\`\`sh
pulse-cli process-definition start invoice --body @start.json --business-key INV-1002
echo '{"businessKey":"INV-1003"}' | pulse-cli process-definition start invoice --body -
\`\`\`

## Files

- \`deployment create\` takes the resource files as arguments; the resource name is the file name,
  or the path relative to \`--base-dir <dir>\`. \`pulse-cli deploy\` also takes directories.
- Binary and file variables upload a file with \`--data <path>\`; \`--out-file\` downloads them.

\`\`\`sh
pulse-cli deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
pulse-cli process-instance set-variable-binary $INSTANCE_ID contract --data contract.pdf --value-type File
pulse-cli process-instance get-variable-binary $INSTANCE_ID contract --out-file contract.pdf
\`\`\`

## Global options

They work after the command (\`pulse-cli task list -o table\`): \`--url\`, \`--engine\`, \`--platform\`,
\`--profile\`, \`--config\`, \`-o/--output\`, \`--fields\`, \`--pretty\`, \`--dry-run\`, \`-y/--yes\`,
\`--read-only\`, \`--timeout\`, \`-H/--header\`, \`--auth\`, \`--auth-user\`, \`--auth-password-stdin\`,
\`--auth-token-stdin\`, \`--verbose\`, \`--out-file\`, \`--show-secrets\`. The help of every command
(\`pulse-cli <group> <command> --help\`) explains them.
`,
}
