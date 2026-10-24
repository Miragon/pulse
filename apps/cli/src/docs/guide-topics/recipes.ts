/** `operate guide recipes`: command lines for everyday tasks. */

import type { GuideTopic } from './topic.js';

export const RECIPES_TOPIC: GuideTopic = {
  name: 'recipes',
  summary: 'Command lines for everyday tasks: deploy, tasks, incidents, messages, history, api',
  text: `# operate guide recipes: command lines for everyday tasks

The recipes use \`$INSTANCE_ID\`, \`$TASK_ID\`, ... for ids from earlier commands. Preview writes you
are unsure about with \`--dry-run\`.

## Deploy and start

\`\`\`sh
operate deploy src/main/resources --start-key invoice --business-key INV-1001 --var amount=250
operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
operate process-definition list --key invoice --latest-version
operate process-definition start invoice --business-key INV-1001 --var amount=250
\`\`\`

## Find instances and complete user tasks

\`\`\`sh
operate process-instance list --process-definition-key invoice --business-key INV-1001
operate process-instance get-variables $INSTANCE_ID
operate task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
operate task claim $TASK_ID --user-id demo
operate task complete $TASK_ID --var approved=true
\`\`\`

## Work on external tasks

The worker id must match the one that locked the task:

\`\`\`sh
operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
operate external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
operate external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
\`\`\`

## Incidents and retries

\`operate retry\` sets the retries of failed jobs and external tasks (root causes only);
\`incident resolve\` only resolves custom incidents:

\`\`\`sh
operate inspect $INSTANCE_ID --stacktrace
operate retry $INSTANCE_ID --now
operate retry --process-definition-key invoice --activity-id send-invoice --dry-run
operate incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
operate job set-retries $JOB_ID --retries 1
operate external-task set-retries $EXTERNAL_TASK_ID --retries 1
operate incident set-annotation $INCIDENT_ID --annotation 'Waiting for the PSP fix'
\`\`\`

## Change running instances

\`\`\`sh
operate process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
operate process-instance set-variable $INSTANCE_ID amount --value 300
operate process-instance suspend $INSTANCE_ID
operate process-instance activate $INSTANCE_ID
operate process-instance delete $INSTANCE_ID --yes
\`\`\`

## Messages, signals and decisions

\`\`\`sh
operate message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
operate signal throw --name invoice-cancelled
operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
\`\`\`

## History

\`\`\`sh
operate historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
operate historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
\`\`\`

## Raw requests

\`operate api <METHOD> <path>\` sends a request relative to the REST root with the same guards,
output and errors. The effect is taken from the matching catalog operation (the query
\`POST /process-instance\` is a read), else GET is a read, DELETE a delete and the rest a write:

\`\`\`sh
operate api GET /process-instance/count --query processDefinitionKey=invoice
operate api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
operate api DELETE /process-instance/$INSTANCE_ID --yes
\`\`\`
`,
};
