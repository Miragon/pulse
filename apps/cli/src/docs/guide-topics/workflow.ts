/** `operate guide workflow`: the workflow commands in detail. */

import type { GuideTopic } from "./topic.js"

export const WORKFLOW_TOPIC: GuideTopic = {
  name: "workflow",
  summary: "Workflow commands in detail: selection, inspect, wait, advance, retry, deploy, status",
  text: `# operate guide workflow: commands that combine requests

The workflow commands are top-level commands (\`operate inspect\`, not \`operate workflow inspect\`)
that combine several requests, so no id passes through you. \`operate commands workflow\` lists them;
\`operate describe <command>\` shows every option and the requests a command sends.

## Selecting the process instance

\`inspect\`, \`wait\`, \`advance\` and \`retry\` take a process instance id, or select the instance with
\`--business-key <key>\` (running or ended) or \`--process-definition-key <key> --latest\` (the most
recently started one). Their views carry \`next\`: the follow-up commands for what they found.

## The commands

- \`operate inspect\`: where an instance waits and why: wait states (also in called instances), root
  incidents with root cause, variables; finds ended instances; \`--history\` adds the timeline,
  \`--stacktrace\` the stacktrace of each incident, \`--no-variables\` leaves the variables out.
- \`operate wait\`: until the instance is idle (no executable job left), or
  \`--until ended|incident|task[:key]|activity:<id>\` (repeatable, any one ends the wait); budget
  \`--wait-timeout\` (default 60s; \`--timeout\` is per request); \`--batch <id>\` waits for a batch;
  \`--execute-jobs\` executes due jobs instead of waiting for the job executor (a write).
- \`operate advance\`: completes what it waits for: user task, external task (locked first), message,
  signal, receive task, timer or job. \`--var\` sets variables, \`--bpmn-error <code>\` throws a BPMN
  error instead, \`--fail <message>\` reports an external task failure (\`--retries\`, default 0: an
  incident); the external task worker is \`--worker-id\`, default \`operate\`.
- \`operate retry\`: sets the retries (\`--retries\`, default 1) behind open incidents (root causes
  only); \`--now\` executes jobs and reports the ones that failed again; \`--incident <ids>\` takes
  named incidents, \`--activity-id\` and \`--incident-type\` narrow the selection;
  \`--process-definition-key <key>\` alone retries every incident of the definition, a bulk
  operation that needs \`--yes\`.
- \`operate deploy\`: deploys changed files and directories (\`*.bpmn\`, \`*.dmn\`, \`*.form\`, ...) under
  one deployment name (\`--name\`, default \`operate\`), skips unchanged files and reports the
  versions in effect; \`--start\` or \`--start-key <key>\` starts an instance (\`--business-key\`,
  \`--var\`).
- \`operate status\`: grouped incidents with root cause, overdue jobs, external task workers, open
  tasks and failed batches, each finding with the next command; \`--fail-on warning|critical\` exits
  with 9 (\`CHECK_FAILED\`) when the status reaches that level, for CI.

## Rules

- Use \`operate wait\` or \`--wait\` (advance, retry, deploy) instead of \`sleep\`; it fails on incidents
  (\`--no-fail-on-incident\` keeps waiting). \`--until\` implies \`--wait\`.
- \`advance\` needs \`--activity-id\` when the instance waits at several places; the error lists them.
- With \`--dry-run\`, \`advance\` and \`retry\` still send their reads (to plan) and preview the writes.
- Exit code 9 (\`INCIDENT\`, \`WAIT_TIMEOUT\`, \`JOB_FAILED\`, ...) still prints the view on stdout.

## Examples

\`\`\`sh
operate inspect --process-definition-key invoice --latest --no-variables
operate inspect $INSTANCE_ID --history --stacktrace
operate wait --business-key B-1 --until task --until ended --wait-timeout 2m
operate advance $INSTANCE_ID --activity-id approve --var approved=true
operate retry --process-definition-key invoice --activity-id send-invoice --dry-run
operate deploy src/main/resources --start-key invoice --business-key INV-1001 --var amount=250
operate status --process-definition-key invoice --fail-on critical
\`\`\`
`,
}
