/** The complete help and describe output of the workflow commands (80 columns, not a terminal). */

import { describe, expect, it } from "vitest"
import { execute, fakeRuntime } from "../../../test/support/fake-runtime.js"
import { run } from "../run.js"

async function output(args: readonly string[]): Promise<string> {
  const result = await execute(run, args, fakeRuntime())
  expect(result.code).toBe(0)
  return result.stdout
}

/** The help without the global options, which help-texts.test.ts checks for every command. */
async function help(name: string): Promise<string> {
  const text = await output([name, "--help"])
  return text.replace(
    /\nGlobal Options:\n[\s\S]*?\n\n/,
    "\nGlobal Options: (see help-texts.test.ts)\n\n",
  )
}

describe("workflow command help", () => {
  it("documents inspect", async () => {
    expect(await help("inspect")).toMatchInlineSnapshot(`
      "Usage: operate inspect [process-instance-id] [options]

      Shows where a process instance waits and why in one call: its wait states (user
      tasks, external tasks, messages, timers, jobs, ...) across the called instances
      below it, the open root incidents with their root cause, the called instances
      and the variables. Finds ended instances through the history; --history adds the
      timeline.

      Requests: the selection (GET /history/process-instance and GET
      /process-instance, filters only), GET /process-instance/{id} and GET
      /history/process-instance/{id}, the tree of called instances (GET
      /process-instance?superProcessInstance=, one round per level), per instance its
      activity instances, incidents and event subscriptions, once the tasks, external
      tasks, jobs, process definitions and job definitions of the tree, the variables,
      with --history the activity and incident history, and the root causes (job
      stacktraces, external task error details).

      Effect: read

      Arguments:
        process-instance-id             Process instance id; or select it with
                                        --business-key / --process-definition-key

      Options:
        --business-key <key>            Select the process instance by business key
                                        (running or ended)
        --process-definition-key <key>  Select by process definition key; with
                                        --latest the most recently started instance
        --latest                        Take the most recently started instance that
                                        matches the filters
        --no-variables                  Leave out the variables of the instance view
                                        (and their request)
        --history                       Add the timeline: activities in BPMN order
                                        with their incidents, from the history
        --stacktrace                    Add the stacktrace (at most 200 lines) to each
                                        incident

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate inspect $INSTANCE_ID
        $ operate inspect --business-key B-1 --history
        $ operate inspect --process-definition-key order-process --latest --no-variables
      "
    `)
  })

  it("documents wait", async () => {
    expect(await help("wait")).toMatchInlineSnapshot(`
      "Usage: operate wait [process-instance-id] [options]

      Waits until the process instance is idle (no executable job left, so it rests in
      wait states), or until the --until conditions; fails fast with exit code 9
      (INCIDENT) when an incident appears, and with WAIT_TIMEOUT after --wait-timeout.
      Prints the instance view with "waited". Use it instead of sleep after every
      asynchronous step. With --batch it waits until the batch finished.

      Requests: the selection, for --until activity:<id> or task:<key> the BPMN of the
      tree and the processes it calls (GET /process-definition/{id}/xml, a typo fails
      at once), then per poll (after 0, 250, 500, 1000 ms, then every 2 s) GET
      /process-instance/{id} (the history when it ended), the tree, the counts the
      conditions need, then the incident count (before it reports idle the instance
      and the tree once more); with --execute-jobs the due jobs (GET /job, POST
      /job/{id}/execute); at the end the instance view; with --batch GET
      /batch/statistics and GET /history/batch/{id}.

      Effect: read; write with --execute-jobs

      Arguments:
        process-instance-id             Process instance id; or select it with
                                        --business-key / --process-definition-key

      Options:
        --business-key <key>            Select the process instance by business key
                                        (running or ended)
        --process-definition-key <key>  Select by process definition key; with
                                        --latest the most recently started instance
        --latest                        Take the most recently started instance that
                                        matches the filters
        --until <condition>             Wait until idle, ended, incident, task,
                                        task:<taskDefinitionKey> or
                                        activity:<activityId>; repeatable, any one
                                        ends the wait
        --wait-timeout <duration>       Total wait budget like 500ms, 30s, 2m or 1h
                                        (default 60s; --timeout is per request)
        --no-fail-on-incident           Keep waiting when an incident appears
                                        (default: fail fast with INCIDENT)
        --execute-jobs                  Execute due jobs of the instance tree on every
                                        poll instead of waiting for the job executor
                                        (a write)
        --no-variables                  Leave out the variables of the instance view
                                        (and their request)
        --batch <batch-id>              Wait until this batch finished instead of a
                                        process instance

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate wait $INSTANCE_ID
        $ operate wait --business-key B-1 --until task --until ended --wait-timeout 2m
        $ operate wait $INSTANCE_ID --until activity:book --execute-jobs
        $ operate wait --batch $BATCH_ID
      "
    `)
  })

  it("documents advance", async () => {
    expect(await help("advance")).toMatchInlineSnapshot(`
      "Usage: operate advance [process-instance-id] [options]

      Completes what the process instance waits for, without passing ids around:
      completes a user task, locks and completes an external task (or reports a
      failure or BPMN error), triggers a message or signal at the waiting execution,
      signals a receive task, or executes a timer or an asynchronous job. Name the
      activity with --activity-id when the instance waits at several places.

      Requests: the selection and the instance view, then per wait state POST
      /task/{id}/complete (or /bpmnError); POST /external-task/{id}/lock and /complete
      (or /failure, /bpmnError; /unlock when that fails); POST
      /execution/{id}/messageSubscriptions/{name}/trigger; POST /signal; POST
      /execution/{id}/signal; or POST /job/{id}/execute; then the instance view, with
      --wait or --until the polls of operate wait (GET /process-instance/{id}, the
      tree, counts of executable jobs, tasks or activities, then of incidents; before
      idle the instance and the tree once more); before the writes, activity and task
      ids of --until are looked up in the BPMN (GET /process-definition/{id}/xml).

      Effect: write; --dry-run sends the reads and previews the writes

      Arguments:
        process-instance-id             Process instance id; or select it with
                                        --business-key / --process-definition-key

      Options:
        --business-key <key>            Select the process instance by business key
                                        (running or ended)
        --process-definition-key <key>  Select by process definition key; with
                                        --latest the most recently started instance
        --latest                        Take the most recently started instance that
                                        matches the filters
        --activity-id <id>              The activity to advance when the instance
                                        waits at several places
        --var <name=value>              Variable of the completion (process scope):
                                        name=value (auto typed: true/false, integers,
                                        decimals, null, else string) or
                                        name:Type=value (String, Integer, Short, Long,
                                        Double, Boolean, Date, Json, Xml, Null; Date
                                        accepts the date-time forms, e.g. 2024-05-01
                                        or 2024-05-01T10:00:00+02:00); repeatable
        --local-var <name=value>        Local variable of an external task completion:
                                        name=value (auto typed: true/false, integers,
                                        decimals, null, else string) or
                                        name:Type=value (String, Integer, Short, Long,
                                        Double, Boolean, Date, Json, Xml, Null; Date
                                        accepts the date-time forms, e.g. 2024-05-01
                                        or 2024-05-01T10:00:00+02:00); repeatable
        --bpmn-error <code>             Throw a BPMN error with this code instead of
                                        completing (user and external tasks)
        --error-message <text>          Message of the BPMN error
        --fail <message>                Report a failure of the external task with
                                        this message instead of completing it
        --retries <n>                   Retries left after --fail (default 0: an
                                        incident)
        --worker-id <id>                Worker that locks and completes an external
                                        task (default operate)
        --wait                          After the writes, wait until the instance is
                                        idle before printing it
        --until <condition>             Wait until idle, ended, incident, task,
                                        task:<taskDefinitionKey> or
                                        activity:<activityId>; repeatable, any one
                                        ends the wait (implies --wait)
        --wait-timeout <duration>       Total wait budget like 500ms, 30s, 2m or 1h
                                        (default 60s; --timeout is per request)
        --no-fail-on-incident           Keep waiting when an incident appears
                                        (default: fail fast with INCIDENT)
        --no-variables                  Leave out the variables of the instance view
                                        (and their request)

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate advance $INSTANCE_ID --var approved=true
        $ operate advance --business-key B-1 --activity-id charge-card --var charged=true --wait
        $ operate advance $INSTANCE_ID --activity-id charge-card --fail 'Card declined'
      "
    `)
  })

  it("documents retry", async () => {
    expect(await help("retry")).toMatchInlineSnapshot(`
      "Usage: operate retry [process-instance-id] [options]

      Sets the retries of the failed jobs and external tasks behind open incidents:
      the incidents of a process instance tree, the named incidents (--incident), or
      every incident of a process definition (--process-definition-key alone, a bulk
      operation that needs --yes). Propagated incidents are replaced by their root
      cause; other incident types are skipped with a hint. --now executes the jobs at
      once and reports a job that failed again as "failed" with its root cause.

      Requests: the selection, GET /process-instance/{id} (GET
      /history/process-instance/{id} for an id that is not running) and its tree, GET
      /incident per instance (or GET /incident/{id}, or GET
      /incident?processDefinitionKeyIn=), GET /incident/{id} for root causes that were
      not loaded, PUT /job/{id}/retries or PUT /external-task/{id}/retries, with --now
      POST /job/{id}/execute, with --wait or --until the polls of operate wait (GET
      /process-instance/{id}, the tree, counts of executable jobs, tasks or
      activities, then of incidents; before idle the instance and the tree once more);
      before the writes, activity and task ids of --until are looked up in the BPMN
      (GET /process-definition/{id}/xml).

      Effect: write; bulk with --process-definition-key alone (requires --yes);
      --dry-run sends the reads and previews the writes

      Arguments:
        process-instance-id             Process instance id; or select it with
                                        --business-key / --process-definition-key

      Options:
        --business-key <key>            Select the process instance by business key
                                        (running or ended)
        --process-definition-key <key>  Select by process definition key; with
                                        --latest the most recently started instance
        --latest                        Take the most recently started instance that
                                        matches the filters
        --incident <ids>                Retry these incidents; comma separated,
                                        repeatable
        --activity-id <id>              Only incidents at this activity
        --incident-type <type>          Only incidents of this type (choices:
                                        failedJob, failedExternalTask)
        --retries <n>                   Retries to set (default 1)
        --now                           Execute the retried jobs at once and report
                                        the ones that failed again
        --wait                          After the writes, wait until the instance is
                                        idle before printing it
        --until <condition>             Wait until idle, ended, incident, task,
                                        task:<taskDefinitionKey> or
                                        activity:<activityId>; repeatable, any one
                                        ends the wait (implies --wait)
        --wait-timeout <duration>       Total wait budget like 500ms, 30s, 2m or 1h
                                        (default 60s; --timeout is per request)
        --no-fail-on-incident           Keep waiting when an incident appears
                                        (default: fail fast with INCIDENT)
        --no-variables                  Leave out the variables of the instance view
                                        (and their request)

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate retry $INSTANCE_ID --now
        $ operate retry --incident $INCIDENT_ID
        $ operate retry --process-definition-key payment --activity-id call-psp --dry-run
      "
    `)
  })

  it("documents deploy", async () => {
    expect(await help("deploy")).toMatchInlineSnapshot(`
      "Usage: operate deploy <paths...> [options]

      Deploys files and directories (scanned for *.bpmn, *.bpmn20.xml, *.dmn,
      *.dmn11.xml and *.form, skipping dot-directories and node_modules) with the same
      deployment name and source every time, so unchanged files are skipped and keep
      their version. Reports per resource whether it was deployed now and the
      definitions in effect. --start or --start-key starts an instance and prints it.

      Requests: GET /deployment (the latest of the name), POST /deployment/create
      (multipart, deploy-changed-only, deployment-source operate), GET
      /deployment/{id}/resources, for unchanged resources GET /deployment (the
      deployments of the name and source) and GET /process-definition, GET
      /decision-definition and GET /decision-requirements-definition per resource,
      with --start POST /process-definition/key/{key}/start and the instance view,
      with --wait or --until the polls of operate wait (GET /process-instance/{id},
      the tree, counts of executable jobs, tasks or activities, then of incidents;
      before idle the instance and the tree once more).

      Effect: write

      Arguments:
        paths                      BPMN, DMN and form files and directories to deploy

      Options:
        --name <deployment-name>   Deployment name (default operate); unchanged files
                                   are skipped per name
        --base-dir <dir>           Name every resource by its path relative to this
                                   directory
        --tenant-id <id>           Tenant of the deployment (and of the started
                                   instance)
        --start                    Start an instance of the only process of the
                                   deployed files
        --start-key <key>          Start an instance of this process definition key
                                   (implies --start)
        --business-key <key>       Business key of the started instance
        --var <name=value>         Variable of the started instance: name=value (auto
                                   typed: true/false, integers, decimals, null, else
                                   string) or name:Type=value (String, Integer, Short,
                                   Long, Double, Boolean, Date, Json, Xml, Null; Date
                                   accepts the date-time forms, e.g. 2024-05-01 or
                                   2024-05-01T10:00:00+02:00); repeatable
        --wait                     After the writes, wait until the instance is idle
                                   before printing it
        --until <condition>        Wait until idle, ended, incident, task,
                                   task:<taskDefinitionKey> or activity:<activityId>;
                                   repeatable, any one ends the wait (implies --wait)
        --wait-timeout <duration>  Total wait budget like 500ms, 30s, 2m or 1h
                                   (default 60s; --timeout is per request)
        --no-fail-on-incident      Keep waiting when an incident appears (default:
                                   fail fast with INCIDENT)
        --no-variables             Leave out the variables of the instance view (and
                                   their request)

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate deploy src/main/resources
        $ operate deploy order-process.bpmn approval.dmn --start --business-key B-1 --var amount=250 --wait
      "
    `)
  })

  it("documents status", async () => {
    expect(await help("status")).toMatchInlineSnapshot(`
      "Usage: operate status [options]

      Engine triage in one call: the definitions with instances and incidents, the
      root incidents grouped by definition, activity, type and message with their root
      cause, overdue executable jobs (is the job executor running?), external task
      topics with waiting, locked and expired tasks (is a worker subscribed?), open
      tasks and failed batches. Every finding names the next command; --fail-on makes
      CI fail on findings.

      Requests: in parallel GET /version, GET /process-definition/statistics, GET
      /incident and /incident/count, GET /external-task and /external-task/count, GET
      /job/count and GET /job (executable, created before --stale-after), GET
      /task/count and GET /batch/statistics; then one root cause per incident group
      shown.

      Effect: read

      Options:
        --process-definition-key <key>  Only these process definition keys; repeatable
        --stale-after <duration>        Jobs and external tasks waiting longer than
                                        this are findings (default 5m)
        --max-groups <n>                Incident groups to show, 1 to 100 (default 10)
        --fail-on <level>               Exit with code 9 (CHECK_FAILED) when the
                                        status reaches this level (choices: warning,
                                        critical)

      Global Options: (see help-texts.test.ts)

      Examples:
        $ operate status
        $ operate status --process-definition-key payment --fail-on warning
      "
    `)
  })
})

describe("workflow command describe", () => {
  it.each(["inspect", "wait", "advance", "retry", "deploy", "status"])(
    "describes the options of %s",
    async (name) => {
      const view = JSON.parse(await output(["describe", name])) as {
        options: unknown[]
        arguments: unknown[]
        examples: unknown[]
      }
      expect({
        arguments: view.arguments,
        options: view.options,
        examples: view.examples,
      }).toMatchSnapshot()
    },
  )
})

describe("workflow command describe text", () => {
  it.each(["inspect", "wait", "advance", "retry", "deploy", "status"])(
    "renders the description of %s",
    async (name) => {
      expect(await output(["describe", name, "-o", "table"])).toMatchSnapshot()
      const view = JSON.parse(await output(["describe", name])) as { calls: unknown[] }
      expect(view.calls).toMatchSnapshot()
    },
  )
})
