/** `pulse-cli guide output`: what stdout and stderr carry. */

import type { GuideTopic } from "./topic.js"

export const OUTPUT_TOPIC: GuideTopic = {
  name: "output",
  summary: "JSON and tables, --fields, XML, text and binary responses, --out-file, previews",
  text: `# pulse-cli guide output: what stdout and stderr carry

## Format

- stdout carries exactly the engine response (workflow commands: their view): JSON, compact when
  piped, indented on a terminal or with \`--pretty\`, always ending with a newline.
- JSON when stdout is not a terminal, a table on a terminal; \`-o json|table\`, \`PULSE_CLI_OUTPUT\` or
  the \`output\` of the profile override it.
- \`--fields id,name,variables.amount\` keeps only these properties (of every element of a list); a
  field that matches nothing gets a warning on stderr that lists the existing fields.
- \`-o table\` prints a table (\`--fields\` picks the columns, otherwise identifying columns come
  first and trailing ones are dropped to fit the terminal); \`-o json\` forces JSON. Count responses
  print as a plain number in a table. Integers beyond 2^53 (\`Long\` variables) are kept exactly.

\`\`\`sh
pulse-cli process-instance list --process-definition-key invoice --fields id,businessKey -o table
pulse-cli task count --assignee demo -o table
\`\`\`

## Responses that are not JSON

- XML commands (\`process-definition xml\`, ...) print the raw XML unless \`-o json\` or \`--fields\`.
- Text responses (\`job get-stacktrace\`, ...) print raw; binary ones need \`--out-file\` on a terminal.
- \`--out-file <path>\` writes the response body to the file exactly as received (projected with
  \`--fields\`) and prints \`{"outFile", "bytes", "contentType"}\`.
- No content (HTTP 204): stdout stays empty, stderr gets \`Done: <METHOD> <path> → 204 No Content\`,
  the path relative to the REST root (as \`pulse-cli api\` takes it).
- Terminals never get control characters from response data; pipes and files get the raw bytes.

\`\`\`sh
pulse-cli process-definition xml invoice --out-file invoice.bpmn
pulse-cli job get-stacktrace $JOB_ID
\`\`\`

## Previews and traces

- \`--dry-run\` prints the request (\`method\`, \`url\`, \`headers\`, \`body\`, \`curl\`) without sending it;
  with \`-o table\` only the \`curl\` line. Secret headers are masked unless \`--show-secrets\`.
- \`--verbose\` traces request and response on stderr (secret headers masked unless \`--show-secrets\`).
- Errors are one JSON line on stderr (\`-o table\` prints readable text instead); the exit code
  table and the error fields are in the core guide (\`pulse-cli guide\`).

\`\`\`sh
pulse-cli task list --assignee demo --dry-run -o table
pulse-cli process-definition list --key invoice --fields id,key,version --verbose
\`\`\`
`,
}
