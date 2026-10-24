/** `pulse-cli guide recipes`: command lines for everyday tasks. */

import type { GuideTopic } from "./topic.js"

export const RECIPES_TOPIC: GuideTopic = {
  name: "recipes",
  summary: "Command lines for everyday tasks: deploy, tasks, incidents, messages, history, api",
  text: `# pulse-cli guide recipes: command lines for everyday tasks

The recipes use \`$INSTANCE_ID\`, \`$TASK_ID\`, ... for ids from earlier commands. Preview writes you
are unsure about with \`--dry-run\`.

## Deploy and start

\`\`\`sh
pulse-cli deploy src/main/resources --start-key invoice --business-key INV-1001 --var amount=250
pulse-cli deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
pulse-cli process-definition list --key invoice --latest-version
pulse-cli process-definition start invoice --business-key INV-1001 --var amount=250
\`\`\`

## Find instances and complete user tasks

\`\`\`sh
pulse-cli process-instance list --process-definition-key invoice --business-key INV-1001
pulse-cli process-instance get-variables $INSTANCE_ID
pulse-cli task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
pulse-cli task claim $TASK_ID --user-id demo
pulse-cli task complete $TASK_ID --var approved=true
\`\`\`

## Work on external tasks

The worker id must match the one that locked the task:

\`\`\`sh
pulse-cli external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
pulse-cli external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
pulse-cli external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
\`\`\`

## Incidents and retries

\`pulse-cli retry\` sets the retries of failed jobs and external tasks (root causes only);
\`incident resolve\` only resolves custom incidents:

\`\`\`sh
pulse-cli inspect $INSTANCE_ID --stacktrace
pulse-cli retry $INSTANCE_ID --now
pulse-cli retry --process-definition-key invoice --activity-id send-invoice --dry-run
pulse-cli incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
pulse-cli job set-retries $JOB_ID --retries 1
pulse-cli external-task set-retries $EXTERNAL_TASK_ID --retries 1
pulse-cli incident set-annotation $INCIDENT_ID --annotation 'Waiting for the PSP fix'
\`\`\`

## Change running instances

\`\`\`sh
pulse-cli process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
pulse-cli process-instance set-variable $INSTANCE_ID amount --value 300
pulse-cli process-instance suspend $INSTANCE_ID
pulse-cli process-instance activate $INSTANCE_ID
pulse-cli process-instance delete $INSTANCE_ID --yes
\`\`\`

## Messages, signals and decisions

\`\`\`sh
pulse-cli message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
pulse-cli signal throw --name invoice-cancelled
pulse-cli decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
\`\`\`

## History

\`\`\`sh
pulse-cli historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
pulse-cli historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
\`\`\`

## Raw requests

\`pulse-cli api <METHOD> <path>\` sends a request relative to the REST root with the same guards,
output and errors. The effect is taken from the matching catalog operation (the query
\`POST /process-instance\` is a read), else GET is a read, DELETE a delete and the rest a write:

\`\`\`sh
pulse-cli api GET /process-instance/count --query processDefinitionKey=invoice
pulse-cli api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
pulse-cli api DELETE /process-instance/$INSTANCE_ID --yes
\`\`\`
`,
}
