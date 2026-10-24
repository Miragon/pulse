# Recipes

The recipes use the variables `$INSTANCE_ID`, `$TASK_ID`, ... for ids from earlier commands.

## Deploy

`pulse-cli deploy` sends only what changed and reports the versions in effect; `deployment create`
is the raw operation.

```sh
pulse-cli deploy src/main/resources
pulse-cli deploy invoice.bpmn invoice-approval.dmn --start --business-key INV-1001 --var amount=250 --wait
pulse-cli deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
pulse-cli deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
pulse-cli process-definition list --key invoice --latest-version
pulse-cli process-definition xml invoice
```

## Start with variables

```sh
pulse-cli process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false
pulse-cli process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
pulse-cli process-instance list --process-definition-key invoice --business-key INV-1001
pulse-cli process-instance get-variables $INSTANCE_ID
```

## Find and complete user tasks

```sh
pulse-cli task list --candidate-group accounting --unassigned
pulse-cli task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
pulse-cli task claim $TASK_ID --user-id demo
pulse-cli task complete $TASK_ID --var approved=true
```

## External task worker

The worker id must match the one that locked the task.

```sh
pulse-cli external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
pulse-cli external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
pulse-cli external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
pulse-cli external-task handle-bpmn-error $EXTERNAL_TASK_ID --worker-id worker-1 --error-code INVALID_ADDRESS
```

## Incidents and job retries

Failed job and external task incidents disappear when retries are set again: `pulse-cli retry`
does it for the root causes behind the incidents, and `--now` executes the jobs at once.
`incident resolve` only resolves custom incidents.

```sh
pulse-cli inspect $INSTANCE_ID --stacktrace
pulse-cli retry $INSTANCE_ID --now
pulse-cli retry --incident $INCIDENT_ID
pulse-cli incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
pulse-cli job list --process-instance-id $INSTANCE_ID --with-exception
pulse-cli job get-stacktrace $JOB_ID
pulse-cli job set-retries $JOB_ID --retries 1
pulse-cli external-task set-retries $EXTERNAL_TASK_ID --retries 1
pulse-cli incident set-annotation $INCIDENT_ID --annotation 'Mail server fixed'
```

## Change running instances

```sh
pulse-cli process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
pulse-cli process-instance suspend $INSTANCE_ID
pulse-cli process-instance activate $INSTANCE_ID
pulse-cli process-instance delete $INSTANCE_ID --yes
```

## History

```sh
pulse-cli historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
pulse-cli historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
pulse-cli historic-variable-instance list --process-instance-id $INSTANCE_ID
```

## Messages and signals

```sh
pulse-cli message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
pulse-cli message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled
pulse-cli signal throw --name invoice-cancelled
```

## Decisions

```sh
pulse-cli decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
pulse-cli decision-definition list --key invoice-approval --latest-version
```

## Raw requests

```sh
pulse-cli api GET /process-instance/count --query processDefinitionKey=invoice
pulse-cli api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
pulse-cli api DELETE /process-instance/$INSTANCE_ID --yes
```
