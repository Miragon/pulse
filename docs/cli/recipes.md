# Recipes

The recipes use the variables `$INSTANCE_ID`, `$TASK_ID`, ... for ids from earlier commands.

## Deploy

`pulse deploy` sends only what changed and reports the versions in effect; `deployment create`
is the raw operation.

```sh
pulse deploy src/main/resources
pulse deploy invoice.bpmn invoice-approval.dmn --start --business-key INV-1001 --var amount=250 --wait
pulse deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
pulse deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
pulse process-definition list --key invoice --latest-version
pulse process-definition xml invoice
```

## Start with variables

```sh
pulse process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false
pulse process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
pulse process-instance list --process-definition-key invoice --business-key INV-1001
pulse process-instance get-variables $INSTANCE_ID
```

## Find and complete user tasks

```sh
pulse task list --candidate-group accounting --unassigned
pulse task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
pulse task claim $TASK_ID --user-id demo
pulse task complete $TASK_ID --var approved=true
```

## External task worker

The worker id must match the one that locked the task.

```sh
pulse external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
pulse external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
pulse external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
pulse external-task handle-bpmn-error $EXTERNAL_TASK_ID --worker-id worker-1 --error-code INVALID_ADDRESS
```

## Incidents and job retries

Failed job and external task incidents disappear when retries are set again: `pulse retry`
does it for the root causes behind the incidents, and `--now` executes the jobs at once.
`incident resolve` only resolves custom incidents.

```sh
pulse inspect $INSTANCE_ID --stacktrace
pulse retry $INSTANCE_ID --now
pulse retry --incident $INCIDENT_ID
pulse incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
pulse job list --process-instance-id $INSTANCE_ID --with-exception
pulse job get-stacktrace $JOB_ID
pulse job set-retries $JOB_ID --retries 1
pulse external-task set-retries $EXTERNAL_TASK_ID --retries 1
pulse incident set-annotation $INCIDENT_ID --annotation 'Mail server fixed'
```

## Change running instances

```sh
pulse process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
pulse process-instance suspend $INSTANCE_ID
pulse process-instance activate $INSTANCE_ID
pulse process-instance delete $INSTANCE_ID --yes
```

## History

```sh
pulse historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
pulse historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
pulse historic-variable-instance list --process-instance-id $INSTANCE_ID
```

## Messages and signals

```sh
pulse message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
pulse message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled
pulse signal throw --name invoice-cancelled
```

## Decisions

```sh
pulse decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
pulse decision-definition list --key invoice-approval --latest-version
```

## Raw requests

```sh
pulse api GET /process-instance/count --query processDefinitionKey=invoice
pulse api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
pulse api DELETE /process-instance/$INSTANCE_ID --yes
```
