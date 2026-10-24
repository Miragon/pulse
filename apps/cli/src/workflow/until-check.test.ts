import type { EnginePort } from '../engine-port/engine-port.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json } from '../../test/support/fake-fetch.js';
import type { Condition } from './conditions.js';

import { checkUntil, parseBpmn } from './until-check.js';

const PARENT_XML = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="defs">
  <bpmn:process id="parent" isExecutable="true">
    <bpmn:startEvent id="start" />
    <bpmn:callActivity id="call-approval" calledElement="child" />
    <bpmn:serviceTask id="book" camunda:asyncBefore="true" />
  </bpmn:process>
</bpmn:definitions>`;
const CHILD_XML = `<process id='child'><userTask id='approve' name="Approve"/></process>`;

function engine(parentXml = PARENT_XML, runtime: Record<string, unknown> = {}) {
  return fakeServer()
    .on('GET', '/process-instance/p1', json({ id: 'p1', definitionId: 'parent:1:d1', ...runtime }))
    .on('GET', '/process-instance', json([]))
    .on('GET', '/process-definition/parent%3A1%3Ad1/xml', json({ bpmn20Xml: parentXml }))
    .on('GET', '/process-definition/key/child/xml', json({ bpmn20Xml: CHILD_XML }));
}

async function usageOf(promise: Promise<void>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; details: { hint?: string } };
  }
  throw new Error('expected a usage error');
}

const activity = (id: string): Condition => ({ kind: 'activity', id });

/** k0 calls k1 calls ... k<last>, which calls nothing. */
function chain(last: number) {
  const server = fakeServer()
    .on('GET', '/process-instance/p1', json({ id: 'p1', definitionId: 'k0:1:d' }))
    .on('GET', '/process-instance', json([]));
  const call = (index: number) =>
    index < last
      ? `<callActivity id="c${index}" calledElement="k${index + 1}"/>`
      : '<task id="t"/>';
  server.on('GET', '/process-definition/k0%3A1%3Ad/xml', json({ bpmn20Xml: call(0) }));
  for (let index = 1; index <= last; index++) {
    server.on('GET', `/process-definition/key/k${index}/xml`, json({ bpmn20Xml: call(index) }));
  }
  return server;
}

describe('parseBpmn', () => {
  it('reads every element id and the keys of static call activities', () => {
    expect(parseBpmn(PARENT_XML)).toEqual({
      ids: ['defs', 'parent', 'start', 'call-approval', 'book'],
      calls: ['child'],
    });
  });

  it.each([
    '<callActivity id="c" calledElement="${next}" />',
    '<callActivity id="c" calledElement="#{next}" />',
    '<callActivity id="c" camunda:caseRef="case" />',
    '<callActivity id="c" calledElement="child" camunda:calledElementBinding="version" />',
  ])('is unsure about a call that is not static: %s', (xml) => {
    expect(parseBpmn(xml)).toBeUndefined();
  });

  it('keeps a latest binding and finds every id attribute (property)', () => {
    expect(
      parseBpmn('<callActivity id="c" calledElement="k" camunda:calledElementBinding="latest"/>'),
    ).toEqual({ ids: ['c'], calls: ['k'] });
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][\w-]{0,8}$/)), (ids) => {
        const xml = ids.map((id) => `<task id="${id}"/>`).join('\n');
        expect(parseBpmn(xml)?.ids).toEqual(ids);
      }),
    );
  });
});

describe('checkUntil', () => {
  it('sends nothing without activity or task-key conditions', async () => {
    const server = engine();
    await checkUntil(portOf(server.fetch), 'p1', [{ kind: 'idle' }, { kind: 'task' }]);
    expect(server.requests).toEqual([]);
  });

  it('accepts ids of the instance, of called processes and multi-instance bodies', async () => {
    const server = engine();
    await checkUntil(portOf(server.fetch), 'p1', [
      activity('book'),
      activity('book#multiInstanceBody'),
      { kind: 'task', key: 'approve' },
    ]);
    expect(server.requests.map((request) => request.path)).toEqual([
      '/process-instance/p1',
      '/process-instance',
      '/process-definition/parent%3A1%3Ad1/xml',
      '/process-definition/key/child/xml',
    ]);
  });

  it('refuses an id of no element with close names and the processes it read', async () => {
    const error = await usageOf(
      checkUntil(portOf(engine().fetch), 'p1', [activity('boook'), { kind: 'task', key: 'x' }]),
    );
    expect(error).toMatchObject({
      code: 'USAGE',
      message: '--until activity:boook, task:x: no such element in the BPMN of parent, child',
      details: {
        hint: 'Did you mean activity:book? Activity ids and task definition keys are the ids of the BPMN elements; `operate process-definition xml parent` shows them.',
      },
    });
    const task = await usageOf(
      checkUntil(portOf(engine().fetch), 'p1', [{ kind: 'task', key: 'aprove' }]),
    );
    expect(task.details.hint).toMatch(/^Did you mean task:approve\? /);
  });

  it.each([
    [
      'an ended instance',
      engine().on(
        'GET',
        '/process-instance/p1',
        engineError(404, 'InvalidRequestException', 'gone'),
      ),
    ],
    ['a tenant', engine(PARENT_XML, { tenantId: 't1' })],
    ['a dynamic call', engine('<callActivity id="c" calledElement="${k}"/>')],
    [
      'a missing XML',
      engine().on(
        'GET',
        '/process-definition/key/child/xml',
        engineError(404, 'RestException', 'no'),
      ),
    ],
    [
      'a failed request',
      engine().on(
        'GET',
        '/process-definition/parent%3A1%3Ad1/xml',
        engineError(500, 'ProcessEngineException', 'boom'),
      ),
    ],
    ['more than 10 processes', chain(11)],
  ])('skips the check for %s', async (_, server) => {
    await expect(
      checkUntil(portOf(server.fetch), 'p1', [activity('nope')]),
    ).resolves.toBeUndefined();
  });

  it('skips the check for a cut tree', async () => {
    const children = Array.from({ length: 101 }, (_, index) => ({
      id: `c${index}`,
      definitionId: 'child:1:c',
    }));
    const server = engine().on('GET', '/process-instance', (request) =>
      json(request.query.get('superProcessInstance') === 'p1' ? children : []),
    );
    await expect(
      checkUntil(portOf(server.fetch), 'p1', [activity('nope')]),
    ).resolves.toBeUndefined();
  });

  it('reads up to 10 processes', async () => {
    const error = await usageOf(checkUntil(portOf(chain(9).fetch), 'p1', [activity('nope')]));
    expect(error.message).toBe(
      '--until activity:nope: no such element in the BPMN of k0, k1, k2, k3, k4, k5, k6, k7, k8, k9',
    );
  });

  it('rethrows errors that are not engine errors', async () => {
    const port = { find: () => Promise.reject(new RangeError('bug')) } as unknown as EnginePort;
    await expect(checkUntil(port, 'p1', [activity('x')])).rejects.toThrow(RangeError);
  });
});
