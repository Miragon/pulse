# Quick start

Start an engine; its REST API is served at `http://localhost:8080/engine-rest` after a few
seconds:

```sh
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
# or camunda/camunda-bpm-platform:run-7.24.0, or cibseven/cibseven:run-2.2.0
```

Check the connection. `http://localhost:8080/engine-rest` is the default, so no configuration is
needed:

```sh
pulse-cli ping --pretty
```

```json
{
  "url": "http://localhost:8080/engine-rest",
  "engine": null,
  "reachable": true,
  "version": "2.1.5",
  "engines": ["default"],
  "latencyMs": 21,
  "auth": "none"
}
```

Create a small process with one user task:

```sh
cat > order.bpmn <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="https://example.com/order">
  <bpmn:process id="order" name="Order" isExecutable="true" camunda:historyTimeToLive="30">
    <bpmn:startEvent id="received" />
    <bpmn:sequenceFlow id="f1" sourceRef="received" targetRef="review" />
    <bpmn:userTask id="review" name="Review order" camunda:candidateGroups="sales" />
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="done" />
    <bpmn:endEvent id="done" />
  </bpmn:process>
</bpmn:definitions>
EOF
```

<figure class="diagram">
  <img src="./assets/quick-start-order.svg" alt="The order process: start event, user task Review order, end event" />
  <figcaption>order.bpmn as a diagram</figcaption>
</figure>

Deploy it, start an instance, and work on the task:

```sh
pulse-cli deployment create order.bpmn --deployment-name order
pulse-cli process-definition start order --business-key ORD-1001 --var amount=250
pulse-cli task list --process-definition-key order --fields id,name,created -o table
```

```text
id                                    name          created
4e3d858c-c35f-11f1-80fb-aa0e0285a34c  Review order  2026-10-08T21:29:12.716+0000
```

```sh
TASK_ID=$(pulse-cli task list --process-definition-key order --fields id | jq -r '.[0].id')
pulse-cli task complete "$TASK_ID" --var approved=true
```

```text
Done: POST /task/4e3d858c-c35f-11f1-80fb-aa0e0285a34c/complete → 204 No Content
```

```sh
pulse-cli historic-process-instance list --process-definition-key order --finished --fields id,businessKey,state -o table
```

```text
id                                    businessKey  state
4e3d5e77-c35f-11f1-80fb-aa0e0285a34c  ORD-1001     COMPLETED
```

Where next: `pulse-cli commands` lists the API groups, `pulse-cli describe <group> <command>`
explains a command and `pulse-cli guide` prints the usage guide.
