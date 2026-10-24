# Recipes

The recipes use the variables `$INSTANCE_ID`, `$TASK_ID`, ... for ids from earlier commands.

## Deploy

`operate deploy` sends only what changed and reports the versions in effect; `deployment create`
is the raw operation.

```sh
operate deploy src/main/resources
operate deploy invoice.bpmn invoice-approval.dmn --start --business-key INV-1001 --var amount=250 --wait
operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
operate process-definition list --key invoice --latest-version
operate process-definition xml invoice
```

## Start with variables

```sh
operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false
operate process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
operate process-instance list --process-definition-key invoice --business-key INV-1001
operate process-instance get-variables $INSTANCE_ID
```

## Find and complete user tasks

```sh
operate task list --candidate-group accounting --unassigned
operate task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
operate task claim $TASK_ID --user-id demo
operate task complete $TASK_ID --var approved=true
```

## External task worker

The worker id must match the one that locked the task.

```sh
operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
operate external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
operate external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
operate external-task handle-bpmn-error $EXTERNAL_TASK_ID --worker-id worker-1 --error-code INVALID_ADDRESS
```

## Incidents and job retries

Failed job and external task incidents disappear when retries are set again: `operate retry`
does it for the root causes behind the incidents, and `--now` executes the jobs at once.
`incident resolve` only resolves custom incidents.

```sh
operate inspect $INSTANCE_ID --stacktrace
operate retry $INSTANCE_ID --now
operate retry --incident $INCIDENT_ID
operate incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
operate job list --process-instance-id $INSTANCE_ID --with-exception
operate job get-stacktrace $JOB_ID
operate job set-retries $JOB_ID --retries 1
operate external-task set-retries $EXTERNAL_TASK_ID --retries 1
operate incident set-annotation $INCIDENT_ID --annotation 'Mail server fixed'
```

## Change running instances

```sh
operate process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
operate process-instance suspend $INSTANCE_ID
operate process-instance activate $INSTANCE_ID
operate process-instance delete $INSTANCE_ID --yes
```

## History

```sh
operate historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
operate historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
operate historic-variable-instance list --process-instance-id $INSTANCE_ID
```

## Messages and signals

```sh
operate message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
operate message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled
operate signal throw --name invoice-cancelled
```

## Decisions

```sh
operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
operate decision-definition list --key invoice-approval --latest-version
```

## Raw requests

```sh
operate api GET /process-instance/count --query processDefinitionKey=invoice
operate api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
operate api DELETE /process-instance/$INSTANCE_ID --yes
```
