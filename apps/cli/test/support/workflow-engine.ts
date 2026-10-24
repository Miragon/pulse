/**
 * A scripted fake engine for the workflow commands: one process instance that waits at the user
 * task `approve`, then at the asynchronous service task `book` (whose job fails on its first
 * execution, creating a failedJob incident), then ends. Writes move it on, `tick()` is the job
 * executor (wire it to the fake runtime's `onSleep`). Instance ids are not checked (any id is the
 * instance, so documented command lines with `$INSTANCE_ID` run), deployments are kept, and every
 * batch is finished. Every request is recorded.
 */

import { engineError, json, noContent, type RecordedRequest, text } from './fake-fetch.js';

export const ENGINE_URL = 'http://localhost:8080/engine-rest';

export type Stage = 'none' | 'approve' | 'book' | 'failed' | 'ended';

interface Definition {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly resource: string;
  readonly deploymentId: string;
}

const T0 = '2026-10-09T10:00:00.000+0000';
const T1 = '2026-10-09T10:00:05.000+0000';
const ERROR =
  "Unknown property used in expression: ${missingBean.run()}. Cause: Cannot resolve identifier 'missingBean'";
const STACKTRACE = `org.camunda.bpm.engine.ProcessEngineException: ${ERROR}\n\tat x.y(Z.java:1)\nCaused by: org.camunda.bpm.impl.juel.PropertyNotFoundException: Cannot resolve identifier 'missingBean'\n`;

const IDS = {
  instance: 'pi-1',
  task: 'task-1',
  job: 'job-1',
  incident: 'inc-1',
  deployment: 'dep-1',
} as const;

type Route = (request: RecordedRequest, match: RegExpExecArray) => Response;

function urlOf(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input);
  return new URL(input instanceof URL ? input.href : input.url);
}

/** The request as the tests see it; the path is relative to the REST root and the engine. */
function recorded(input: string | URL | Request, init: RequestInit | undefined): RecordedRequest {
  const url = urlOf(input);
  const body = init?.body;
  return {
    method: init?.method ?? 'GET',
    url: url.href,
    path: url.pathname.replace(/^\/engine-rest/, '').replace(/^\/engine\/[^/]+/, ''),
    query: url.searchParams,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof body === 'string' || body instanceof FormData ? body : undefined,
  };
}

export class WorkflowEngine {
  readonly requests: RecordedRequest[] = [];
  stage: Stage;
  businessKey = 'B-1';
  key = 'invoice';
  attempts = 0;
  readonly variables: Record<string, { value: unknown; type: string }> = {};
  readonly definitions: Definition[] = [];
  private readonly deployed = new Map<string, string>();
  /** Resource names per deployment id. */
  private readonly resources = new Map<string, string[]>();
  private readonly routes: [string, RegExp, Route][];

  /**
   * `lenient` (for the documented command lines): unknown routes answer a generic `{}` (`[]` for
   * paged lists) and writes at the wrong stage succeed without changing anything.
   */
  constructor(
    stage: Stage = 'approve',
    private readonly lenient = false,
  ) {
    this.stage = stage;
    // an instance with a failed job has had its first (failing) attempt
    if (stage === 'failed') this.attempts = 1;
    if (stage !== 'none')
      this.definitions.push(this.definition('invoice', 'invoice.bpmn', IDS.deployment));
    this.routes = this.table();
  }

  readonly fetch: typeof globalThis.fetch = (input, init) => {
    const request = recorded(input, init);
    this.requests.push(request);
    for (const [method, pattern, route] of this.routes) {
      const match = method === request.method ? pattern.exec(request.path) : null;
      if (match !== null) return Promise.resolve(route(request, match));
    }
    if (this.lenient) return Promise.resolve(json(request.query.has('maxResults') ? [] : {}));
    const message = `No fake route for ${request.method} ${request.path}`;
    return Promise.resolve(engineError(404, 'NotFoundException', message));
  };

  /** The job executor: runs the due job of `book` (it fails on the first attempt). */
  tick(): void {
    if (this.stage === 'book') this.runJob();
  }

  private runJob(): boolean {
    this.attempts += 1;
    if (this.attempts === 1) {
      this.stage = 'failed';
      return false;
    }
    this.stage = 'ended';
    return true;
  }

  private definition(key: string, resource: string, deploymentId: string): Definition {
    const version = this.definitions.filter((definition) => definition.key === key).length + 1;
    return {
      id: `${key}:${version}:def-${this.definitions.length + 1}`,
      key,
      version,
      resource,
      deploymentId,
    };
  }

  private get active(): boolean {
    return this.stage === 'approve' || this.stage === 'book' || this.stage === 'failed';
  }

  private get definitionId(): string {
    return (
      this.definitions.find((definition) => definition.key === this.key)?.id ?? `${this.key}:1:def`
    );
  }

  private instanceDto(id: string) {
    return {
      id,
      definitionId: this.definitionId,
      definitionKey: this.key,
      businessKey: this.businessKey,
      ended: false,
      suspended: false,
    };
  }

  private historyDto(id: string) {
    return {
      id,
      businessKey: this.businessKey,
      processDefinitionId: this.definitionId,
      processDefinitionKey: this.key,
      processDefinitionVersion: 1,
      startTime: T0,
      ...(this.active ? {} : { endTime: T1, durationInMillis: 5000 }),
      rootProcessInstanceId: id,
      state: this.active ? 'ACTIVE' : 'COMPLETED',
    };
  }

  private activityTree(id: string) {
    const approve = {
      id: 'approve:ai-1',
      activityId: 'approve',
      activityName: 'Approve',
      activityType: 'userTask',
      executionIds: [id],
      childActivityInstances: [],
      childTransitionInstances: [],
    };
    const book = {
      id: 'book:ti-1',
      activityId: 'book',
      activityName: 'Book',
      activityType: 'serviceTask',
      executionId: id,
    };
    return {
      id,
      activityId: this.definitionId,
      activityType: 'processDefinition',
      processInstanceId: id,
      executionIds: [id],
      childActivityInstances: this.stage === 'approve' ? [approve] : [],
      childTransitionInstances: this.stage === 'approve' ? [] : [book],
    };
  }

  private tasks(id: string) {
    return this.stage === 'approve'
      ? [
          {
            id: IDS.task,
            name: 'Approve',
            taskDefinitionKey: 'approve',
            executionId: id,
            processInstanceId: id,
            created: T0,
          },
        ]
      : [];
  }

  private jobs(id: string) {
    if (this.stage !== 'book' && this.stage !== 'failed') return [];
    const failed = this.stage === 'failed';
    return [
      {
        id: IDS.job,
        jobDefinitionId: 'jd-1',
        processInstanceId: id,
        executionId: id,
        retries: failed ? 0 : 3,
        dueDate: null,
        createTime: T0,
        ...(failed ? { exceptionMessage: ERROR, failedActivityId: 'book' } : {}),
      },
    ];
  }

  private incidents(id: string, always = false) {
    return always || this.stage === 'failed'
      ? [
          {
            id: IDS.incident,
            rootCauseIncidentId: IDS.incident,
            incidentType: 'failedJob',
            activityId: 'book',
            processInstanceId: id,
            processDefinitionId: this.definitionId,
            configuration: IDS.job,
            incidentMessage: ERROR,
            incidentTimestamp: T1,
          },
        ]
      : [];
  }

  private deploy(request: RecordedRequest): Response {
    const form = request.body instanceof FormData ? request.body : new FormData();
    const parts = [...form.entries()].filter(([, value]) => typeof value !== 'string');
    const field = form.get('deployment-name');
    const name = typeof field === 'string' ? field : '';
    const fingerprint = `${name}|${parts.map(([field]) => field).join(',')}`;
    const existing = this.deployed.get(fingerprint);
    if (existing !== undefined) {
      return json({
        id: existing,
        name,
        source: 'operate',
        deploymentTime: T0,
        deployedProcessDefinitions: null,
        deployedDecisionDefinitions: null,
        deployedDecisionRequirementsDefinitions: null,
      });
    }
    const id = `dep-${this.deployed.size + 2}`;
    this.deployed.set(fingerprint, id);
    this.resources.set(
      id,
      parts.map(([field]) => field),
    );
    const processes = parts
      .filter(([field]) => field.endsWith('.bpmn'))
      .map(([field]) =>
        this.definition((field.split('/').at(-1) ?? field).replace(/\.bpmn$/, ''), field, id),
      );
    this.definitions.push(...processes);
    const map = Object.fromEntries(processes.map((definition) => [definition.id, definition]));
    return json({
      id,
      name,
      source: 'operate',
      deploymentTime: T1,
      deployedProcessDefinitions: processes.length > 0 ? map : null,
      deployedDecisionDefinitions: null,
      deployedDecisionRequirementsDefinitions: null,
    });
  }

  private start(match: RegExpExecArray, request: RecordedRequest): Response {
    const body = JSON.parse(typeof request.body === 'string' ? request.body : '{}') as {
      businessKey?: string;
      variables?: Record<string, { value: unknown; type: string }>;
    };
    this.key = decodeURIComponent(match[1] ?? 'invoice');
    this.businessKey = body.businessKey ?? 'B-1';
    Object.assign(this.variables, body.variables ?? {});
    this.stage = 'approve';
    this.attempts = 0;
    return json(this.instanceDto(IDS.instance));
  }

  /** The instance counts of the polls: with an incident, at an activity, or at all. */
  private instanceCount(request: RecordedRequest): number {
    if (!this.active) return 0;
    if (request.query.get('withIncident') === 'true') return this.stage === 'failed' ? 1 : 0;
    const activity = request.query.get('activityIdIn');
    if (activity === null) return 1;
    return activity === (this.stage === 'approve' ? 'approve' : 'book') ? 1 : 0;
  }

  private count(value: number): Response {
    return json({ count: value });
  }

  private table(): [string, RegExp, Route][] {
    const id = (match: RegExpExecArray) => decodeURIComponent(match[1] ?? IDS.instance);
    const missing = () =>
      engineError(404, 'InvalidRequestException', 'Process instance does not exist');
    return [
      ['GET', /^\/version$/, () => json({ version: '7.24.0' })],
      ['GET', /^\/engine$/, () => json([{ name: 'default' }])],
      ['GET', /^\/process-instance\/count$/, (request) => this.count(this.instanceCount(request))],
      [
        'GET',
        /^\/process-instance$/,
        (request) =>
          json(
            this.active &&
              !request.query.has('superProcessInstance') &&
              !request.query.has('subProcessInstance')
              ? [this.instanceDto(IDS.instance)]
              : [],
          ),
      ],
      [
        'GET',
        /^\/process-instance\/([^/]+)$/,
        (_, match) => (this.active ? json(this.instanceDto(id(match))) : missing()),
      ],
      [
        'GET',
        /^\/process-instance\/([^/]+)\/activity-instances$/,
        (_, match) => json(this.activityTree(id(match))),
      ],
      ['GET', /^\/process-instance\/([^/]+)\/variables$/, () => json(this.variables)],
      ['PUT', /^\/process-instance\/([^/]+)\/variables\/([^/]+)$/, () => noContent()],
      [
        'POST',
        /^\/process-instance\/delete$/,
        () => json({ id: 'batch-1', type: 'instance-deletion', totalJobs: 1 }),
      ],
      [
        'GET',
        /^\/history\/process-instance$/,
        () => json(this.stage === 'none' ? [] : [this.historyDto(IDS.instance)]),
      ],
      [
        'GET',
        /^\/history\/process-instance\/([^/]+)$/,
        (_, match) => (this.stage === 'none' ? missing() : json(this.historyDto(id(match)))),
      ],
      [
        'GET',
        /^\/history\/variable-instance$/,
        () =>
          json(
            Object.entries(this.variables).map(([name, typed]) => ({
              name,
              ...typed,
              activityInstanceId: IDS.instance,
            })),
          ),
      ],
      [
        'GET',
        /^\/history\/activity-instance$/,
        () =>
          json([
            {
              activityId: 'start',
              activityType: 'startEvent',
              startTime: T0,
              endTime: T0,
              durationInMillis: 0,
            },
          ]),
      ],
      ['GET', /^\/history\/activity-instance\/count$/, () => this.count(1)],
      ['GET', /^\/history\/incident$/, () => json([])],
      [
        'GET',
        /^\/history\/batch\/([^/]+)$/,
        (_, match) =>
          json({
            id: id(match),
            type: 'instance-deletion',
            totalJobs: 1,
            startTime: T0,
            endTime: T1,
          }),
      ],
      ['GET', /^\/batch\/statistics$/, () => json([])],
      ['GET', /^\/incident$/, () => json(this.incidents(IDS.instance))],
      ['GET', /^\/incident\/count$/, () => this.count(this.incidents(IDS.instance).length)],
      ['GET', /^\/incident\/([^/]+)$/, () => this.incident()],
      ['GET', /^\/event-subscription$/, () => json([])],
      ['GET', /^\/task$/, () => json(this.tasks(IDS.instance))],
      ['GET', /^\/task\/count$/, () => this.count(this.tasks(IDS.instance).length)],
      ['POST', /^\/task\/([^/]+)\/complete$/, (request) => this.complete(request)],
      ['GET', /^\/external-task$/, () => json([])],
      ['GET', /^\/external-task\/count$/, () => this.count(0)],
      [
        'GET',
        /^\/job$/,
        (request) =>
          json(
            request.query.get('timers') === 'true'
              ? []
              : this.jobs(IDS.instance).filter(
                  (job) => request.query.get('executable') !== 'true' || job.retries > 0,
                ),
          ),
      ],
      [
        'GET',
        /^\/job\/count$/,
        (request) =>
          this.count(
            this.jobs(IDS.instance).filter(
              (job) => request.query.get('executable') !== 'true' || job.retries > 0,
            ).length,
          ),
      ],
      [
        'GET',
        /^\/job\/([^/]+)$/,
        () =>
          this.jobs(IDS.instance)[0] === undefined
            ? engineError(404, 'InvalidRequestException', 'No job found')
            : json(this.jobs(IDS.instance)[0]),
      ],
      ['GET', /^\/job\/([^/]+)\/stacktrace$/, () => text(STACKTRACE, 'text/plain')],
      ['POST', /^\/job\/([^/]+)\/execute$/, () => this.execute()],
      ['PUT', /^\/job\/([^/]+)\/retries$/, () => this.setRetries()],
      [
        'GET',
        /^\/job-definition$/,
        () => json([{ id: 'jd-1', activityId: 'book', jobType: 'async-continuation' }]),
      ],
      ['GET', /^\/process-definition$/, (request) => json(this.definitionsFor(request))],
      ['GET', /^\/process-definition\/statistics$/, () => json(this.statistics())],
      [
        'POST',
        /^\/process-definition\/key\/([^/]+)\/start$/,
        (request, match) => this.start(match, request),
      ],
      ['GET', /^\/decision-definition$/, () => json([])],
      ['GET', /^\/decision-requirements-definition$/, () => json([])],
      ['GET', /^\/deployment$/, (request) => json(this.deployments(request))],
      ['POST', /^\/deployment\/create$/, (request) => this.deploy(request)],
      [
        'GET',
        /^\/deployment\/([^/]+)\/resources$/,
        (_, match) =>
          json((this.resources.get(id(match)) ?? []).map((name) => ({ id: `r-${name}`, name }))),
      ],
    ];
  }

  /** The incident of the failed job; a lenient engine always has it (documented examples). */
  private incident(): Response {
    if (this.stage !== 'failed' && !this.lenient) {
      return engineError(404, 'InvalidRequestException', 'Incident does not exist');
    }
    const [incident] = this.incidents(IDS.instance, true);
    return json(incident);
  }

  /** A write the stage does not allow: 404, or nothing at all when lenient. */
  private refused(message: string): Response {
    return this.lenient ? noContent() : engineError(404, 'InvalidRequestException', message);
  }

  private execute(): Response {
    if (this.stage !== 'book' && this.stage !== 'failed') return this.refused('No job found');
    return this.runJob() ? noContent() : engineError(404, 'InvalidRequestException', ERROR);
  }

  private complete(request: RecordedRequest): Response {
    if (this.stage !== 'approve') return this.refused('Cannot find task');
    const body = JSON.parse(typeof request.body === 'string' ? request.body : '{}') as {
      variables?: Record<string, { value: unknown; type: string }>;
    };
    Object.assign(this.variables, body.variables ?? {});
    this.stage = 'book';
    return noContent();
  }

  private setRetries(): Response {
    if (this.stage !== 'failed') return this.refused('No job found');
    this.stage = 'book';
    return noContent();
  }

  private definitionsFor(request: RecordedRequest) {
    const resource = request.query.get('resourceName');
    const ids = request.query.get('processDefinitionIdIn')?.split(',');
    return this.definitions.filter(
      (definition) =>
        (resource === null || definition.resource === resource) &&
        (ids === undefined || ids.includes(definition.id)),
    );
  }

  /** The deployments of a name: the latest with `maxResults=1`, else all of them. */
  private deployments(request: RecordedRequest) {
    const name = request.query.get('name');
    const all = [...this.deployed.entries()]
      .filter(([fingerprint]) => fingerprint.startsWith(`${name ?? ''}|`))
      .map(([, id]) => ({ id, name, deploymentTime: T0 }));
    return request.query.get('maxResults') === '1' ? all.slice(-1) : all;
  }

  private statistics() {
    return this.definitions.map((definition) => ({
      id: definition.id,
      instances: this.active && definition.key === this.key ? 1 : 0,
      failedJobs: this.stage === 'failed' && definition.key === this.key ? 1 : 0,
      incidents:
        this.stage === 'failed' && definition.key === this.key
          ? [{ incidentType: 'failedJob', incidentCount: 1 }]
          : [],
      definition,
    }));
  }
}

/** Paths of the recorded requests, `METHOD /path`. */
export function routes(engine: WorkflowEngine): string[] {
  return engine.requests.map((request) => `${request.method} ${request.path}`);
}
