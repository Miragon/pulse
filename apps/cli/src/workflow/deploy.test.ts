import { describe, expect, it } from 'vitest';
import { depsOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json } from '../../test/support/fake-fetch.js';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { WorkflowEngine } from '../../test/support/workflow-engine.js';
import { loadCatalog } from '../catalog/catalog.js';
import { deploy, type DeployOptions } from './deploy.js';

/** A BPMN file with executable processes (and one that is not executable). */
function bpmn(...ids: string[]): string {
  const processes = ids.map((id) => `<bpmn:process id="${id}" isExecutable="true">`).join('');
  return `<bpmn:definitions>${processes}<bpmn:process id="draft" isExecutable="false"/></bpmn:definitions>`;
}

const ORDER = bpmn('order');
const FILES = { 'res/order.bpmn': ORDER, 'res/approval.dmn': '<x/>', 'res/approve.form': '{}' };
const BASE: DeployOptions = { paths: ['res'], variablesShown: false, dryRun: false };

function depsFor(fetch: typeof globalThis.fetch, files: Readonly<Record<string, string>> = FILES) {
  return { ...depsOf(fetch), fs: fakeRuntime({ files }).fs, catalog: loadCatalog() };
}

const BEFORE = { id: 'dep-1', name: 'operate', deploymentTime: '2026-01-01T00:00:00.000+0000' };

function engine(deployment: Record<string, unknown>, held: readonly string[] = []) {
  return fakeServer()
    .on('GET', '/deployment', json([BEFORE]))
    .on('POST', '/deployment/create', json(deployment))
    .on(
      'GET',
      `/deployment/${String(deployment.id)}/resources`,
      json(held.map((name) => ({ id: `r-${name}`, name }))),
    )
    .on('GET', '/process-definition', (request) =>
      json([
        {
          id: 'order:3:x',
          key: 'order',
          version: 3,
          name: 'Order',
          resource: request.query.get('resourceName'),
          deploymentId: 'dep-1',
        },
      ]),
    )
    .on(
      'GET',
      '/decision-definition',
      json([{ id: 'approval:2:x', key: 'approval', version: 2, deploymentId: 'dep-1' }]),
    )
    .on('GET', '/decision-requirements-definition', json([]));
}

describe('deploy', () => {
  it('reports an unchanged deployment with the versions in effect per resource', async () => {
    const server = engine({ ...BEFORE, deployedProcessDefinitions: null });
    const result = await deploy(depsFor(server.fetch), BASE);
    expect(result).toEqual({
      kind: 'view',
      view: {
        deploymentId: 'dep-1',
        name: 'operate',
        changed: false,
        deploymentTime: '2026-01-01T00:00:00.000+0000',
        resources: [
          {
            resource: 'approval.dmn',
            status: 'unchanged',
            definitions: [{ type: 'decision', key: 'approval', version: 2, id: 'approval:2:x' }],
          },
          { resource: 'approve.form', status: 'unchanged', definitions: [] },
          {
            resource: 'order.bpmn',
            status: 'unchanged',
            definitions: [
              { type: 'process', key: 'order', version: 3, id: 'order:3:x', name: 'Order' },
            ],
          },
        ],
      },
    });
    const list = server.requests[0];
    expect(list?.query.toString()).toBe(
      'name=operate&sortBy=deploymentTime&sortOrder=desc&maxResults=1',
    );
    const form = server.requests[1]?.body as FormData;
    expect([...form.keys()]).toEqual([
      'deployment-name',
      'deployment-source',
      'deploy-changed-only',
      'approval.dmn',
      'approve.form',
      'order.bpmn',
    ]);
    const latest = server.requests.find((request) => request.path === '/process-definition');
    expect(latest?.query.toString()).toBe('resourceName=order.bpmn&firstResult=0&maxResults=500');
    const own = server.requests.find((request) => request.query.get('source') === 'operate');
    expect(own?.query.get('name')).toBe('operate');
  });

  it('reports a new deployment: its resources deployed, the others unchanged', async () => {
    const deployed = {
      id: 'dep-2',
      name: 'release',
      deploymentTime: '2026-01-02T00:00:00.000+0000',
      deployedProcessDefinitions: {
        'order:4:y': { id: 'order:4:y', key: 'order', version: 4, resource: 'order.bpmn' },
      },
      deployedDecisionDefinitions: null,
    };
    const server = engine(deployed, ['order.bpmn', 'approve.form']);
    const result = await deploy(depsFor(server.fetch), {
      ...BASE,
      name: 'release',
      tenantId: 't1',
    });
    expect(result.kind === 'view' ? result.view : undefined).toMatchObject({
      deploymentId: 'dep-2',
      changed: true,
      resources: [
        { resource: 'approval.dmn', status: 'unchanged' },
        { resource: 'approve.form', status: 'deployed', definitions: [] },
        {
          resource: 'order.bpmn',
          status: 'deployed',
          definitions: [{ type: 'process', key: 'order', version: 4, id: 'order:4:y' }],
        },
      ],
    });
    expect(server.requests[0]?.query.get('tenantIdIn')).toBe('t1');
    expect((server.requests[1]?.body as FormData).get('tenant-id')).toBe('t1');
  });

  it('treats an older deployment with another id and a first deployment correctly', async () => {
    const older = engine({ id: 'dep-0', deploymentTime: '2025-01-01T00:00:00.000+0000' });
    expect(await deploy(depsFor(older.fetch), BASE)).toMatchObject({ view: { changed: false } });
    const first = engine({ id: 'dep-9', deploymentTime: '2026-01-01T00:00:00.000+0000' }).on(
      'GET',
      '/deployment',
      json([]),
    );
    expect(await deploy(depsFor(first.fetch), BASE)).toMatchObject({ view: { changed: true } });
  });

  it('previews the multipart request with --dry-run and sends nothing', async () => {
    const server = fakeServer();
    const result = await deploy(depsFor(server.fetch), {
      ...BASE,
      dryRun: true,
      start: {},
      businessKey: 'B-1',
    });
    expect(result).toMatchObject({
      kind: 'dry-run',
      plan: {
        name: 'operate',
        resources: [
          { resource: 'approval.dmn', file: 'res/approval.dmn' },
          { resource: 'approve.form', file: 'res/approve.form' },
          { resource: 'order.bpmn', file: 'res/order.bpmn' },
        ],
        start: { key: 'order', businessKey: 'B-1' },
      },
      requests: [{ summary: 'deploy 3 resource(s) as operate', operationId: 'createDeployment' }],
    });
    expect(server.requests).toEqual([]);
  });

  it('starts the only process and waits for the instance', async () => {
    const fake = new WorkflowEngine('none');
    const deps = {
      ...depsOf(fake.fetch, () => {
        fake.tick();
      }),
      fs: fakeRuntime({ files: { 'bpmn/order.bpmn': ORDER } }).fs,
      catalog: loadCatalog(),
    };
    const result = await deploy(deps, {
      ...BASE,
      paths: ['bpmn'],
      start: {},
      businessKey: 'B-7',
      variables: { amount: { value: 1, type: 'Integer' } },
      wait: {
        conditions: [{ kind: 'task', key: 'approve' }],
        timeoutMs: 1000,
        failOnIncident: true,
        executeJobs: false,
      },
    });
    expect(result).toMatchObject({
      kind: 'view',
      view: { instance: { businessKey: 'B-7', waited: { until: 'task:approve' } } },
    });
  });

  it('refuses to guess the process to start before anything is deployed', async () => {
    const server = fakeServer();
    await expect(
      deploy(depsFor(server.fetch, { 'res/two.bpmn': bpmn('a', 'b'), 'res/c.bpmn': bpmn('a') }), {
        ...BASE,
        start: {},
      }),
    ).rejects.toThrow('The files contain 2 processes: a, b');
    await expect(
      deploy(depsFor(server.fetch, { 'f/approve.form': '{}' }), {
        ...BASE,
        paths: ['f'],
        start: {},
      }),
    ).rejects.toThrow('The files contain no process to start');
    expect(server.requests).toEqual([]);
  });

  it('prints the deployment before the error of a start that failed', async () => {
    const server = engine({ ...BEFORE }).on(
      'POST',
      '/process-definition/key/nope/start',
      engineError(404, 'RestException', 'No matching process definition with key: nope'),
    );
    const result = await deploy(depsFor(server.fetch), { ...BASE, start: { key: 'nope' } });
    expect(result).toMatchObject({
      kind: 'view',
      view: { deploymentId: 'dep-1', changed: false },
      failure: { code: 'NOT_FOUND' },
    });
    expect(result.kind === 'view' ? result.view.instance : 'x').toBeUndefined();
  });

  it('starts by key and tenant id', async () => {
    const server = engine({ ...BEFORE })
      .on('POST', '/process-definition/key/order/tenant-id/t1/start', json({ id: 'p9' }))
      .on('GET', '/process-instance/p9', json({ id: 'p9', definitionId: 'order:3:x' }))
      .on(
        'GET',
        '/history/process-instance/p9',
        json({
          id: 'p9',
          processDefinitionId: 'order:3:x',
          processDefinitionKey: 'order',
          state: 'ACTIVE',
        }),
      )
      .on('GET', '/process-instance', json([]))
      .on(
        'GET',
        '/process-instance/p9/activity-instances',
        json({
          id: 'p9',
          processInstanceId: 'p9',
          childActivityInstances: [],
          childTransitionInstances: [],
        }),
      )
      .on('GET', '/incident', json([]))
      .on('GET', '/event-subscription', json([]))
      .on('GET', '/task', json([]))
      .on('GET', '/external-task', json([]))
      .on('GET', '/job', json([]))
      .on('GET', '/job-definition', json([]));
    const result = await deploy(depsFor(server.fetch), {
      ...BASE,
      tenantId: 't1',
      start: { key: 'order' },
    });
    expect(result).toMatchObject({
      view: { instance: { id: 'p9', definition: { key: 'order' } } },
    });
    const broken = engine({ ...BEFORE }).on(
      'POST',
      '/process-definition/key/order/start',
      json({}),
    );
    expect(await deploy(depsFor(broken.fetch), { ...BASE, start: { key: 'order' } })).toMatchObject(
      { failure: { message: 'Starting order returned no process instance id' } },
    );
  });
});

describe('deploy details', () => {
  it('sends the file contents and the settings, and asks for the latest deployment of the name', async () => {
    const server = engine({ ...BEFORE });
    await deploy(depsFor(server.fetch), BASE);
    const form = server.requests.find((request) => request.path === '/deployment/create')
      ?.body as FormData;
    expect(await (form.get('order.bpmn') as File).text()).toBe(ORDER);
    expect(
      ['deployment-name', 'deployment-source', 'deploy-changed-only'].map((name) => form.get(name)),
    ).toEqual(['operate', 'operate', 'true']);
    expect(form.has('tenant-id')).toBe(false);
    expect(Object.fromEntries(server.requests[0]?.query ?? [])).toEqual({
      name: 'operate',
      sortBy: 'deploymentTime',
      sortOrder: 'desc',
      maxResults: '1',
    });
  });

  it('is unchanged for another id with the same deployment time', async () => {
    const same = engine({ id: 'dep-3', deploymentTime: BEFORE.deploymentTime });
    expect(await deploy(depsFor(same.fetch), BASE)).toMatchObject({ view: { changed: false } });
  });

  it('names the fix when the process to start is unclear', async () => {
    await expect(
      deploy(depsFor(fakeServer().fetch, { 'res/two.bpmn': bpmn('a', 'b') }), {
        ...BASE,
        start: {},
      }),
    ).rejects.toMatchObject({
      code: 'USAGE',
      details: { hint: 'Choose one with --start-key <key>, e.g. --start-key a.' },
    });
    await expect(
      deploy(depsFor(fakeServer().fetch, { 'f/approve.form': '{}' }), {
        ...BASE,
        paths: ['f'],
        start: {},
      }),
    ).rejects.toMatchObject({
      details: { hint: 'Deploy a BPMN file, or start an existing process with --start-key <key>.' },
    });
  });

  it('fails when the start returns no instance id', async () => {
    const server = engine({ ...BEFORE }).on(
      'POST',
      '/process-definition/key/order/start',
      json({ links: [] }),
    );
    expect(await deploy(depsFor(server.fetch), { ...BASE, start: { key: 'order' } })).toMatchObject(
      {
        kind: 'view',
        failure: { code: 'INTERNAL', message: 'Starting order returned no process instance id' },
      },
    );
  });

  it('reports the failure of the wait after the start, with the instance view', async () => {
    const fake = new WorkflowEngine('none');
    const deps = {
      ...depsOf(fake.fetch, () => {
        fake.tick();
      }),
      fs: fakeRuntime({ files: { 'bpmn/order.bpmn': ORDER } }).fs,
      catalog: loadCatalog(),
    };
    const result = await deploy(deps, {
      ...BASE,
      paths: ['bpmn'],
      start: { key: 'invoice' },
      wait: {
        conditions: [{ kind: 'ended' }],
        timeoutMs: 500,
        failOnIncident: true,
        executeJobs: false,
      },
    });
    expect(result).toMatchObject({
      kind: 'view',
      view: { instance: { state: 'ACTIVE' } },
      failure: { code: 'WAIT_TIMEOUT' },
    });
    const instance = result.kind === 'view' ? result.view.instance : undefined;
    expect(instance).not.toHaveProperty('timeline');
    expect(fake.requests.some((request) => request.path === '/history/activity-instance')).toBe(
      false,
    );
  });
});

describe('deploy with an unusual catalog', () => {
  it('is an internal error when createDeployment takes no multipart body', async () => {
    const catalog = loadCatalog();
    const broken = {
      ...catalog,
      operations: catalog.operations.filter(
        (operation) => operation.operationId !== 'createDeployment',
      ),
    };
    await expect(
      deploy({ ...depsFor(fakeServer().fetch), catalog: broken }, BASE),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'createDeployment has no multipart body',
    });
  });
});
