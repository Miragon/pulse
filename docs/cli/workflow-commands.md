# Workflow commands

The generated commands map the REST API one to one. Six top-level workflow commands combine
several requests for the questions a developer, an operator or an agent asks most. They select a
process instance by id, `--business-key` or `--process-definition-key <key> --latest`, and their
views list ready-to-run follow-ups under `next`.

This page is the overview. The CLI has the full text: `operate guide workflow` for the options and
rules, `operate describe <command>` for the requests a command sends.

| Command           | Effect                              | What it does                                                            |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `operate inspect` | read                                | Where an instance waits and why: wait states, root incidents, variables |
| `operate wait`    | read (write with `--execute-jobs`)  | Waits until the instance is idle or reaches an `--until` condition      |
| `operate advance` | write                               | Completes what the instance waits for                                   |
| `operate retry`   | write (bulk for a whole definition) | Sets the retries behind open incidents; `--now` executes the jobs       |
| `operate deploy`  | write                               | Deploys changed files and directories, can start an instance            |
| `operate status`  | read                                | Engine triage: incidents by root cause, overdue jobs, workers, batches  |

The development loop, without a single id passed around:

```sh
operate deploy bpmn --start --business-key B-1 --var amount=250
operate inspect --business-key B-1
operate advance --business-key B-1 --var approved=true --wait
operate retry --business-key B-1 --now
operate wait --business-key B-1 --until ended
operate status
```

On a terminal, or with `-o table`, a view prints as sections:

```text
$ operate inspect --business-key ORD-1001 -o table
Process instance  391a7907-c652-11f1-9fc4-1a2aceba9a9d
State             ACTIVE
Definition        order-process v1 (Order process)
Business key      ORD-1001
Started           2026-10-12T15:33:07.285+0000

Waiting at:
ACTIVITY      KIND      ID                                    DETAIL        INSTANCE
review-order  userTask  391a790c-c652-11f1-9fc4-1a2aceba9a9d  Review order

Variables:
NAME    VALUE  TYPE
amount  250

Next:
  operate advance 391a7907-c652-11f1-9fc4-1a2aceba9a9d
```

- **Waiting** replaces `sleep` and poll loops: `operate wait`, and `--wait` / `--until` of
  advance, retry and deploy, poll until the condition holds or `--wait-timeout` (default `60s`)
  runs out. An incident ends the wait at once.
- **Exit code 9**: every request succeeded, but the process did not reach the expected state
  (`WAIT_TIMEOUT`, `INCIDENT`, `INSTANCE_ENDED`, `JOB_FAILED`, `CHECK_FAILED`). The command still
  prints its view on stdout.
- **`--dry-run`**: inspect, wait and status send nothing; advance and retry send their reads and
  preview the writes; deploy previews the upload.
- **Guards**: inspect, wait and status work in read-only mode; advance, deploy, retry and
  `wait --execute-jobs` are writes; `retry --process-definition-key` alone is a bulk operation
  that needs `--yes`.
- `advance` needs `--activity-id` when the instance waits at several places; the error lists them
  with ready commands.
