/**
 * The diagrams of the Camunda 7 status world (`seedC7StatusWorld`), each a process without a
 * drawing: the status triage, the overview's health and the verdict read no diagram but for the
 * names of its elements.
 */

const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" ' +
  'targetNamespace="http://bpmn.io/schema/bpmn"'

/** A diagram of one process: its id, its name and its elements and flows. */
function diagram(id: string, name: string, body: string): string {
  return (
    `${HEAD} id="Definitions_${id}">\n` +
    `  <bpmn:process id="${id}" name="${name}" isExecutable="true" ` +
    'camunda:historyTimeToLive="1">\n' +
    `${body}\n  </bpmn:process>\n</bpmn:definitions>\n`
  )
}

/** A sequence flow from `source` to `target`. */
function flow(source: string, target: string): string {
  return `    <bpmn:sequenceFlow id="Flow_${source}_${target}" sourceRef="${source}" targetRef="${target}" />`
}

/**
 * The process a call raises its root incident in: its asynchronous service task calls a bean no
 * engine knows, so its job fails until its retries are used up.
 */
export const STATUS_LABEL_DIAGRAM = diagram(
  "pulse-status-label",
  "Print parcel label",
  [
    '    <bpmn:startEvent id="Event_Start" />',
    flow("Event_Start", "Activity_RenderLabel"),
    '    <bpmn:serviceTask id="Activity_RenderLabel" name="Render label" ' +
      'camunda:asyncBefore="true" camunda:expression="${labelPrinter.print(parcelId)}" />',
    flow("Activity_RenderLabel", "Event_End"),
    '    <bpmn:endEvent id="Event_End" />',
  ].join("\n"),
)

/** The tenant the dispatch's call activity names, so its call starts the label deployed there. */
export const STATUS_CALLED_TENANT = "pulse-north"

/**
 * The process whose call activity waits for the label's incident and holds a copy of it: the
 * dispatch has no tenant, its call names the tenant of the label it starts
 * (`calledElementTenantId`), so the chain's root incident is raised on a tenant's version.
 */
export const STATUS_DISPATCH_DIAGRAM = diagram(
  "pulse-status-dispatch",
  "Ship parcel",
  [
    '    <bpmn:startEvent id="Event_Start" />',
    flow("Event_Start", "Activity_PrintLabel"),
    '    <bpmn:callActivity id="Activity_PrintLabel" name="Print label" ' +
      `calledElement="pulse-status-label" camunda:calledElementTenantId="${STATUS_CALLED_TENANT}" />`,
    flow("Activity_PrintLabel", "Event_End"),
    '    <bpmn:endEvent id="Event_End" />',
  ].join("\n"),
)

/**
 * The process of the multi-instance body: its user task repeats once per `copies`, and its body
 * (`Activity_ApproveEach#multiInstanceBody`) waits asynchronously before it starts its items, so
 * an instance without `copies` fails there.
 */
export const STATUS_APPROVAL_DIAGRAM = diagram(
  "pulse-status-approval",
  "Approve items",
  [
    '    <bpmn:startEvent id="Event_Start" />',
    flow("Event_Start", "Activity_ApproveEach"),
    '    <bpmn:userTask id="Activity_ApproveEach" name="Approve each" camunda:asyncBefore="true">',
    "      <bpmn:multiInstanceLoopCharacteristics>",
    "        <bpmn:loopCardinality>${copies}</bpmn:loopCardinality>",
    "      </bpmn:multiInstanceLoopCharacteristics>",
    "    </bpmn:userTask>",
    flow("Activity_ApproveEach", "Event_End"),
    '    <bpmn:endEvent id="Event_End" />',
  ].join("\n"),
)
