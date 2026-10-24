import {
  BpmnProcessId,
  ElementId,
  type ElementImplementation,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import type { ElementLink } from '../../src/core/panels/model-links.js';
import { ModelFactsView } from '../../src/core/views/model-facts-view.js';

function linkTo(
  implementation: ElementImplementation,
  errors = [{ name: 'Declined' }],
): ElementLink {
  return {
    model: {
      uri: 'file:///shop/order.bpmn',
      fileName: 'order.bpmn',
      bpmnProcessId: BpmnProcessId('order'),
      xml: '<order />',
    },
    elementId: ElementId('Activity_Charge'),
    element: {
      location: { uri: 'file:///shop/order.bpmn', line: 3 },
      configuration: { implementation, inputs: [], outputs: [], errors },
    },
    code: { uri: 'file:///shop/src/Charge%20Worker.java', line: 1 },
    differsFromDeployed: false,
  };
}

describe('the model facts of an element', () => {
  test.each([
    [
      { kind: 'class', className: 'io.shop.Charge' },
      { label: 'Class', value: 'io.shop.Charge' },
    ],
    [
      { kind: 'delegate', expression: '${charge}' },
      { label: 'Delegate', value: '${charge}' },
    ],
    [
      { kind: 'expression', expression: '${a.b()}' },
      { label: 'Expression', value: '${a.b()}' },
    ],
  ] as const)('label %o', (implementation, setting) => {
    expect(ModelFactsView.of(linkTo(implementation)).settings).toEqual([
      setting,
      { label: 'Error', value: 'Declined' },
    ]);
  });

  test('leave out the task type the job already names, and keep one that differs', () => {
    const worker = linkTo({ kind: 'workerTask', taskType: 'charge' }, []);

    expect(ModelFactsView.of(worker, 'charge').settings).toEqual([]);
    expect(ModelFactsView.of(worker, 'charge-v2').settings).toEqual([
      { label: 'Task type', value: 'charge' },
    ]);
    expect(
      ModelFactsView.of(linkTo({ kind: 'class', className: 'charge' }, []), 'charge').settings,
    ).toEqual([{ label: 'Class', value: 'charge' }]);
  });

  test('name the code file without URI escapes', () => {
    const facts = ModelFactsView.of(linkTo({ kind: 'workerTask', taskType: 'charge' }, []));
    expect(facts.codeLabel).toBe('Charge Worker.java');
  });

  test('show an error with a code only', () => {
    const facts = ModelFactsView.of(
      linkTo({ kind: 'workerTask', taskType: 'charge' }, [{ code: 'DECLINED' }] as never),
    );
    expect(facts.settings.at(-1)).toEqual({ label: 'Error', value: 'DECLINED' });
  });
});
