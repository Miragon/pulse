import {
  BpmnProcessId,
  type InstanceId,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { DefinitionPanel } from '../../src/core/panels/definition-panel.js';
import { InstancePanel } from '../../src/core/panels/instance-panel.js';
import type { DefinitionView, InstanceView, PanelState } from '../../src/core/protocol/index.js';
import {
  CHARGE_PAYMENT,
  LocalSourcesFixture,
  WORKER_CODE,
  type LocalWorkspace,
} from './support/local-sources.js';
import { panelFixture } from './support/panel-fixture.js';

function readyView<Kind extends 'instance' | 'definition'>(
  state: PanelState,
  kind: Kind,
): Kind extends 'instance' ? InstanceView : DefinitionView {
  if (state.status !== 'ready' || state.view.kind !== kind) {
    throw new Error(`expected a ready ${kind} view, got ${state.status}`);
  }
  return state.view as Kind extends 'instance' ? InstanceView : DefinitionView;
}

async function deployedXml(runtime: ProcessRuntime, instanceId: InstanceId): Promise<string> {
  const detail = await runtime.getInstanceDetail(instanceId);
  return (await runtime.getDiagramXml(detail!.instance.definition.id)) ?? '';
}

async function openInstance(
  businessKey: 'ORD-1002' | 'DSP-3001',
  workspace: (deployed: string) => LocalWorkspace,
) {
  const probe = panelFixture();
  const instanceId = probe.world.instanceIds[businessKey];
  const deployed = await deployedXml(probe.context.runtime, instanceId);
  const local = LocalSourcesFixture.of(workspace(deployed));
  const fixture = panelFixture(undefined, { sources: local.sources });
  const panel = new InstancePanel(fixture.context, fixture.world.instanceIds[businessKey]);
  await panel.handle({ type: 'ready' });
  const view = readyView(fixture.lastState(), 'instance');
  return { fixture, panel, view, local, incident: view.incidents[0]! };
}

describe('the model links of an instance', () => {
  test('show what the local model configures on the element and where its code is', async () => {
    const { incident } = await openInstance('ORD-1002', (deployed) => ({
      models: { 'pulse-order': deployed },
      elements: { Activity_ChargePayment: CHARGE_PAYMENT },
      code: WORKER_CODE,
    }));

    expect(incident.model).toEqual({
      fileName: 'pulse-order.bpmn',
      settings: [
        { label: 'Task type', value: 'charge-payment' },
        { label: 'Input', value: 'amount ← ${order.total}' },
        { label: 'Input', value: 'currency' },
        { label: 'Output', value: 'paymentId ← ${receipt.id}' },
        { label: 'Error', value: 'CARD_EXPIRED (CardExpired)' },
        { label: 'Error', value: 'DECLINED' },
      ],
      codeLabel: 'ChargePaymentWorker.java',
    });
  });

  test('say when the local model differs from the deployed version', async () => {
    const { incident } = await openInstance('ORD-1002', () => ({
      models: { 'pulse-order': '<definitions id="changed" />' },
      elements: { Activity_ChargePayment: CHARGE_PAYMENT },
    }));

    expect(incident.model?.differsFromDeployed).toBe(true);
    expect(incident.model?.codeLabel).toBeUndefined();
  });

  test('open the model at the element and the code at its line', async () => {
    const { fixture, panel, incident } = await openInstance('ORD-1002', (deployed) => ({
      models: { 'pulse-order': deployed },
      elements: { Activity_ChargePayment: CHARGE_PAYMENT },
      code: WORKER_CODE,
    }));

    await panel.handle({ type: 'openModel', incidentId: incident.id });
    await panel.handle({ type: 'openCode', incidentId: incident.id });

    expect(fixture.effects.openModel).toHaveBeenCalledWith(
      { uri: 'file:///shop/pulse-order.bpmn', line: 7 },
      'Activity_ChargePayment',
    );
    expect(fixture.effects.openSource).toHaveBeenCalledWith(WORKER_CODE);
  });

  test('open the top of the file when the element is not in the local model', async () => {
    const { fixture, panel, incident } = await openInstance('ORD-1002', (deployed) => ({
      models: { 'pulse-order': deployed },
    }));

    expect(incident.model).toEqual({ fileName: 'pulse-order.bpmn', settings: [] });
    await panel.handle({ type: 'openModel', incidentId: incident.id });
    await panel.handle({ type: 'openCode', incidentId: incident.id });

    expect(fixture.effects.openModel).toHaveBeenCalledWith({
      uri: 'file:///shop/pulse-order.bpmn',
      line: 1,
    });
    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });

  test('look up an incident of a called instance in the model of the called process', async () => {
    const { incident, local } = await openInstance('DSP-3001', () => ({
      models: { 'pulse-label': '<label />' },
    }));

    expect(local.modelOf).toHaveBeenCalledWith('pulse-label');
    expect(incident.model?.fileName).toBe('pulse-label.bpmn');
  });

  test('hide the links without a local model and ignore intents for them', async () => {
    const { fixture, panel, incident } = await openInstance('ORD-1002', () => ({}));

    await panel.handle({ type: 'openModel', incidentId: incident.id });
    await panel.handle({ type: 'openModel' });
    await panel.handle({ type: 'openCode', incidentId: 'unknown' });

    expect(incident.model).toBeUndefined();
    expect(fixture.effects.openModel).not.toHaveBeenCalled();
    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });

  test('hide the links when the workspace cannot be read, and still show the instance', async () => {
    const { view, incident } = await openInstance('ORD-1002', () => ({ failing: true }));

    expect(view.incidents).toHaveLength(1);
    expect(incident.model).toBeUndefined();
  });

  test('hide the links without local sources', async () => {
    const fixture = panelFixture();
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds['ORD-1002']);

    await panel.handle({ type: 'ready' });
    await panel.handle({ type: 'openModel', incidentId: 'any' });

    expect(readyView(fixture.lastState(), 'instance').incidents[0]?.model).toBeUndefined();
    expect(fixture.effects.openModel).not.toHaveBeenCalled();
  });
});

describe('the selected element of an instance', () => {
  const workspace = (deployed: string): LocalWorkspace => ({
    models: { 'pulse-order': deployed },
    elements: { Activity_ChargePayment: CHARGE_PAYMENT },
    code: WORKER_CODE,
  });

  test('opens the model only from an incident, never from the header or a shape', async () => {
    const { fixture, panel, view, local } = await openInstance('ORD-1002', workspace);

    await panel.handle({ type: 'selectElement', elementId: 'Activity_ChargePayment' });
    await panel.handle({ type: 'openModel' });
    await panel.handle({ type: 'openModel', elementId: 'Activity_ChargePayment' });
    await panel.handle({ type: 'openCode' });

    expect(view.model).toEqual({ fileName: 'pulse-order.bpmn' });
    expect(local.modelOf).toHaveBeenCalledWith('pulse-order');
    expect(fixture.effects.openModel).not.toHaveBeenCalled();
    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });

  test('opens the code of the element clicked in the diagram', async () => {
    const { fixture, panel } = await openInstance('ORD-1002', workspace);

    await panel.handle({ type: 'selectElement', elementId: 'Activity_ChargePayment' });
    await panel.handle({ type: 'openCode', elementId: 'Activity_Other' });
    await panel.handle({ type: 'openCode', elementId: 'Activity_ChargePayment' });

    expect(readyView(fixture.lastState(), 'instance').model).toEqual({
      fileName: 'pulse-order.bpmn',
      code: { elementId: 'Activity_ChargePayment', label: 'ChargePaymentWorker.java' },
    });
    expect(fixture.effects.openSource).toHaveBeenCalledTimes(1);
    expect(fixture.effects.openSource).toHaveBeenCalledWith(WORKER_CODE);
  });

  test('opens the code of an incident element from its shape without a selection', async () => {
    const { fixture, panel, view } = await openInstance('ORD-1002', workspace);

    await panel.handle({ type: 'openCode', elementId: 'Activity_ChargePayment' });

    expect(view.model).toEqual({ fileName: 'pulse-order.bpmn' });
    expect(fixture.effects.openSource).toHaveBeenCalledWith(WORKER_CODE);
  });

  test('keeps the code of the selection out of the incident cards', async () => {
    const { fixture, panel } = await openInstance('ORD-1002', workspace);

    await panel.handle({ type: 'selectElement', elementId: 'Activity_Unknown' });

    const view = readyView(fixture.lastState(), 'instance');
    expect(view.model).toEqual({ fileName: 'pulse-order.bpmn' });
    expect(view.incidents[0]?.model?.codeLabel).toBe('ChargePaymentWorker.java');
  });

  test('ignores a selection before the instance has loaded and without a local model', async () => {
    const early = panelFixture();
    const waiting = new InstancePanel(early.context, early.world.instanceIds['ORD-1002']);
    await waiting.handle({ type: 'selectElement', elementId: 'Activity_ChargePayment' });

    const { fixture, panel, view } = await openInstance('ORD-1002', () => ({}));
    await panel.handle({ type: 'selectElement', elementId: 'Activity_ChargePayment' });
    await panel.handle({ type: 'openCode', elementId: 'Activity_ChargePayment' });

    expect(early.states).toEqual([]);
    expect(view.model).toBeUndefined();
    expect(readyView(fixture.lastState(), 'instance').model).toBeUndefined();
    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });
});

describe('the model link of a definition', () => {
  async function openDefinition(workspace: LocalWorkspace, elementId?: string) {
    const local = LocalSourcesFixture.of(workspace);
    const fixture = panelFixture(undefined, { sources: local.sources });
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: BpmnProcessId('pulse-order'),
      ...(elementId === undefined ? {} : { filter: { scope: 'running', elementId } }),
    });
    await panel.handle({ type: 'ready' });
    return { fixture, panel, local, view: readyView(fixture.lastState(), 'definition') };
  }

  test('names the local file and opens it at the element of the diagram', async () => {
    const { fixture, panel, view } = await openDefinition(
      {
        models: { 'pulse-order': '<order />' },
        elements: { Activity_ChargePayment: CHARGE_PAYMENT },
      },
      'Activity_ChargePayment',
    );

    await panel.handle({ type: 'openModel', elementId: 'Activity_ChargePayment' });

    expect(view.model).toEqual({ fileName: 'pulse-order.bpmn', differsFromDeployed: true });
    expect(fixture.effects.openModel).toHaveBeenCalledWith(
      { uri: 'file:///shop/pulse-order.bpmn', line: 7 },
      'Activity_ChargePayment',
    );
  });

  test('opens the code of the element the list is filtered by', async () => {
    const { fixture, panel, view } = await openDefinition(
      {
        models: { 'pulse-order': '<order />' },
        elements: { Activity_ChargePayment: CHARGE_PAYMENT },
        code: WORKER_CODE,
      },
      'Activity_ChargePayment',
    );

    await panel.handle({ type: 'openCode' });
    await panel.handle({ type: 'openCode', elementId: 'Activity_ChargePayment' });

    expect(view.model).toEqual({
      fileName: 'pulse-order.bpmn',
      differsFromDeployed: true,
      code: { elementId: 'Activity_ChargePayment', label: 'ChargePaymentWorker.java' },
    });
    expect(fixture.effects.openSource).toHaveBeenCalledTimes(1);
    expect(fixture.effects.openSource).toHaveBeenCalledWith(WORKER_CODE);
  });

  test('looks for code only once an element is selected', async () => {
    const { fixture, panel, local, view } = await openDefinition({
      models: { 'pulse-order': '<order />' },
      elements: { Activity_ChargePayment: CHARGE_PAYMENT },
      code: WORKER_CODE,
    });

    await panel.handle({ type: 'openCode' });

    expect(view.model).toEqual({ fileName: 'pulse-order.bpmn', differsFromDeployed: true });
    expect(local.elementIn).not.toHaveBeenCalled();
    expect(local.locate).not.toHaveBeenCalled();
    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });

  test('ignores Open code before the panel has loaded', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: BpmnProcessId('pulse-order'),
    });

    await panel.handle({ type: 'openCode' });

    expect(fixture.effects.openSource).not.toHaveBeenCalled();
  });

  test('opens the top of the file without a filtered element', async () => {
    const { fixture, panel } = await openDefinition({ models: { 'pulse-order': '<order />' } });

    await panel.handle({ type: 'openModel' });

    expect(fixture.effects.openModel).toHaveBeenCalledWith({
      uri: 'file:///shop/pulse-order.bpmn',
      line: 1,
    });
  });

  test('has no model link without a local file', async () => {
    const { fixture, panel, view } = await openDefinition({});

    await panel.handle({ type: 'openModel' });

    expect(view.model).toBeUndefined();
    expect(fixture.effects.openModel).not.toHaveBeenCalled();
  });
});
