import type { WriteCase } from "./write-cases.js"

const BATCH = { id: "b-1", type: "set-job-retries", totalJobs: 2, jobsCreated: 0 }

/** External tasks, incidents, jobs, batches, migrations, deployments. */
export const OPERATIONS_WRITE_CASES: WriteCase[] = [
  {
    toolName: "camunda7_set_external_task_retries",
    title: "puts the retries on the external task",
    args: { externalTaskId: "ext-1", retries: 3 },
    wire: [{ method: "PUT", path: "/external-task/ext-1/retries", body: { retries: 3 } }],
    result: { success: true, externalTaskId: "ext-1", retries: 3 },
  },
  {
    toolName: "camunda7_fetch_and_lock",
    title: "locks with the schema defaults",
    args: { workerId: "w-1", topics: [{ topicName: "mail" }] },
    routes: { "POST /external-task/fetchAndLock": { body: [] } },
    wire: [
      {
        method: "POST",
        path: "/external-task/fetchAndLock",
        body: {
          workerId: "w-1",
          maxTasks: 10,
          topics: [{ topicName: "mail", lockDuration: 300000 }],
        },
      },
    ],
    result: [],
  },
  {
    toolName: "camunda7_complete_external_task",
    title: "completes as the worker with serialized variables",
    args: {
      externalTaskId: "ext-1",
      workerId: "w-1",
      variables: { result: { value: ["ok"], type: "Json" } },
    },
    wire: [
      {
        method: "POST",
        path: "/external-task/ext-1/complete",
        body: { workerId: "w-1", variables: { result: { value: '["ok"]', type: "Json" } } },
      },
    ],
    result: { success: true, externalTaskId: "ext-1" },
  },
  {
    toolName: "camunda7_handle_external_task_failure",
    title: "always sends the retries (the engine reads a missing value as 0 → incident)",
    args: {
      externalTaskId: "ext-1",
      workerId: "w-1",
      errorMessage: "boom",
      retries: 2,
      retryTimeout: 60000,
    },
    wire: [
      {
        method: "POST",
        path: "/external-task/ext-1/failure",
        body: { workerId: "w-1", errorMessage: "boom", retries: 2, retryTimeout: 60000 },
      },
    ],
    result: { success: true, externalTaskId: "ext-1" },
  },
  {
    toolName: "camunda7_resolve_incident",
    title: "deletes the (custom) incident",
    args: { incidentId: "inc-1" },
    wire: [{ method: "DELETE", path: "/incident/inc-1" }],
    result: { success: true, incidentId: "inc-1" },
  },
  {
    toolName: "camunda7_set_job_retries",
    title: "puts the retries on the job",
    args: { jobId: "job-1", retries: 1 },
    wire: [{ method: "PUT", path: "/job/job-1/retries", body: { retries: 1 } }],
    result: { success: true, jobId: "job-1", retries: 1 },
  },
  {
    toolName: "camunda7_set_job_retries_batch",
    title: "converts the due date and reports the batch as queued, never as done",
    args: { jobIds: ["job-1", "job-2"], retries: 2, dueDate: "2026-10-01T00:00:00Z" },
    routes: { "POST /job/retries": { body: BATCH } },
    wire: [
      {
        method: "POST",
        path: "/job/retries",
        body: { jobIds: ["job-1", "job-2"], retries: 2, dueDate: "2026-10-01T00:00:00.000+0000" },
      },
    ],
    result: {
      batchId: "b-1",
      status: "queued",
      type: "set-job-retries",
      totalJobs: 2,
      jobCount: 2,
      retries: 2,
    },
  },
  {
    toolName: "camunda7_migrate_process_instances_async",
    title: "executes the given mapping and reports the batch as queued",
    args: {
      sourceProcessDefinitionId: "order:1:a",
      targetProcessDefinitionId: "order:2:b",
      processInstanceIds: ["pi-1"],
      instructions: [{ sourceActivityIds: ["A"], targetActivityIds: ["A"] }],
    },
    routes: { "POST /migration/executeAsync": { body: { ...BATCH, type: "instance-migration" } } },
    wire: [
      {
        method: "POST",
        path: "/migration/executeAsync",
        body: {
          migrationPlan: {
            sourceProcessDefinitionId: "order:1:a",
            targetProcessDefinitionId: "order:2:b",
            instructions: [{ sourceActivityIds: ["A"], targetActivityIds: ["A"] }],
          },
          processInstanceIds: ["pi-1"],
        },
      },
    ],
    result: {
      batchId: "b-1",
      status: "queued",
      type: "instance-migration",
      totalJobs: 2,
      instanceCount: 1,
    },
  },
  {
    toolName: "camunda7_migrate_process_instances_async",
    title: "generates the mapping first when none is given (the execute endpoint derives none)",
    args: {
      sourceProcessDefinitionId: "order:1:a",
      targetProcessDefinitionId: "order:2:b",
      processInstanceIds: ["pi-1", "pi-2"],
      skipCustomListeners: true,
    },
    routes: {
      "POST /migration/generate": {
        body: {
          sourceProcessDefinitionId: "order:1:a",
          targetProcessDefinitionId: "order:2:b",
          instructions: [
            { sourceActivityIds: ["T"], targetActivityIds: ["T"], updateEventTrigger: false },
          ],
        },
      },
      "POST /migration/executeAsync": { body: BATCH },
    },
    wire: [
      {
        method: "POST",
        path: "/migration/generate",
        body: { sourceProcessDefinitionId: "order:1:a", targetProcessDefinitionId: "order:2:b" },
      },
      {
        method: "POST",
        path: "/migration/executeAsync",
        body: {
          migrationPlan: {
            sourceProcessDefinitionId: "order:1:a",
            targetProcessDefinitionId: "order:2:b",
            instructions: [
              { sourceActivityIds: ["T"], targetActivityIds: ["T"], updateEventTrigger: false },
            ],
          },
          processInstanceIds: ["pi-1", "pi-2"],
          skipCustomListeners: true,
        },
      },
    ],
  },
  {
    toolName: "camunda7_create_deployment",
    title: "posts one multipart deployment",
    args: {
      deploymentName: "orders",
      resources: [{ name: "order.bpmn", content: "<definitions/>" }],
    },
    routes: { "POST /deployment/create": { body: { id: "dep-1" } } },
    wire: [{ method: "POST", path: "/deployment/create", body: "multipart" }],
    result: { id: "dep-1" },
  },
]
