import type { IncidentRow, InstanceView } from '../../src/core/protocol/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFINITION_VIEW } from '../../dev/webview/fixtures/definition.js';
import { INSTANCE_WITH_CALLED_INCIDENT } from '../../dev/webview/fixtures/instance.js';
import { mountApp, waitForElement } from './harness.js';
import type { Harness } from './harness.js';

const INCIDENT = INSTANCE_WITH_CALLED_INCIDENT.incidents[0]!;

function withIncident(incident: IncidentRow): InstanceView {
  return { ...INSTANCE_WITH_CALLED_INCIDENT, incidents: [incident] };
}

function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
}

function header(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.context-bar') ?? root;
}

function facts(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.incident-card .facts dt')].map(
    (term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ''}`,
  );
}

describe('the model and code links of an incident', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  async function show(view: InstanceView): Promise<void> {
    harness = mountApp();
    harness.publish({ status: 'ready', refreshing: false, view });
    await waitForElement(harness.root, '.incident-card');
  }

  it('shows what the local model configures and opens model and code by incident', async () => {
    await show(INSTANCE_WITH_CALLED_INCIDENT);

    button(harness.root, 'Open in model')?.click();
    button(harness.root, 'Open code')?.click();

    expect(facts(harness.root)).toEqual(
      expect.arrayContaining([
        'Delegate: ${scoringApiClient}',
        'Input: applicant ← ${customer}',
        'Error: SCORING_UNAVAILABLE',
        'Model: credit-scoring.bpmn',
      ]),
    );
    expect(button(harness.root, 'Open code')?.title).toBe('Open ScoringApiClient.java');
    expect(harness.posted).toContainEqual({ type: 'openModel', incidentId: INCIDENT.id });
    expect(harness.posted).toContainEqual({ type: 'openCode', incidentId: INCIDENT.id });
  });

  it('says when the local model differs from the deployed version', async () => {
    await show(
      withIncident({ ...INCIDENT, model: { ...INCIDENT.model!, differsFromDeployed: true } }),
    );

    expect(facts(harness.root)).toContain(
      'Model: credit-scoring.bpmn· differs from the deployed version',
    );
  });

  it('says each fact once: no message the root cause repeats, no engine type', async () => {
    await show(withIncident({ ...INCIDENT, message: 'Connection refused' }));
    const repeated = facts(harness.root);

    harness.unmount();
    await show(INSTANCE_WITH_CALLED_INCIDENT);

    expect(repeated.some((fact) => fact.startsWith('Message:'))).toBe(false);
    expect(facts(harness.root)).toContain(`Message: ${INCIDENT.message}`);
    expect(harness.root.querySelector('.incident-card')?.textContent).not.toContain(
      INCIDENT.engineType,
    );
  });

  it('offers no code link when no code was found', async () => {
    const { fileName, settings } = INCIDENT.model!;
    await show(withIncident({ ...INCIDENT, model: { fileName, settings } }));

    expect(button(harness.root, 'Open in model')).toBeDefined();
    expect(button(harness.root, 'Open code')).toBeUndefined();
  });

  it('hides model facts and links without a local model', async () => {
    const { model, ...withoutModel } = INCIDENT;
    await show(withIncident(withoutModel));

    expect(model).toBeDefined();

    expect(facts(harness.root).some((fact) => fact.startsWith('Model:'))).toBe(false);
    expect(button(harness.root, 'Open in model')).toBeUndefined();
    expect(button(harness.root, 'Open code')).toBeUndefined();
  });
});

describe('the model link of a definition', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('opens the local model from the header and is absent without one', async () => {
    harness = mountApp();
    harness.publish({
      status: 'ready',
      refreshing: false,
      view: { ...DEFINITION_VIEW, model: { fileName: 'order-fulfillment.bpmn' } },
    });
    await waitForElement(harness.root, '.context-bar');

    const open = button(harness.root, 'Open model');
    open?.click();

    expect(open?.title).toBe('Open order-fulfillment.bpmn');
    expect(harness.posted).toContainEqual({ type: 'openModel' });

    harness.unmount();
    harness = mountApp();
    harness.publish({ status: 'ready', refreshing: false, view: DEFINITION_VIEW });
    await waitForElement(harness.root, '.context-bar');
    expect(button(harness.root, 'Open model')).toBeUndefined();
  });

  it('opens the filtered element in the model from the header and its code from its shape', async () => {
    harness = mountApp();
    harness.publish({
      status: 'ready',
      refreshing: false,
      view: {
        ...DEFINITION_VIEW,
        filter: { scope: 'running', elementId: 'Activity_ReserveStock' },
        model: {
          fileName: 'order-fulfillment.bpmn',
          differsFromDeployed: true,
          code: { elementId: 'Activity_ReserveStock', label: 'ReserveStockWorker.java' },
        },
      },
    });
    const openCode = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[data-code-for="Activity_ReserveStock"]',
    );
    const openModel = button(header(harness.root), 'Open model');

    openCode.click();
    openModel?.click();

    expect(openCode.title).toBe('Open ReserveStockWorker.java');
    expect(openModel?.title).toBe(
      'Open order-fulfillment.bpmn at Reserve stock (differs from the deployed version)',
    );
    expect(harness.posted).toContainEqual({ type: 'openCode', elementId: 'Activity_ReserveStock' });
    expect(harness.posted).toContainEqual({
      type: 'openModel',
      elementId: 'Activity_ReserveStock',
    });
    expect(harness.root.querySelectorAll('.djs-overlay .code-button')).toHaveLength(1);
  });
});

describe('the model link of an instance', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('puts the code of incident elements on their shape and no model button in the header', async () => {
    harness = mountApp();
    const local: IncidentRow = {
      id: INCIDENT.id,
      shortId: INCIDENT.shortId,
      elementId: 'Activity_ReserveStock',
      typeLabel: INCIDENT.typeLabel,
      engineType: INCIDENT.engineType,
      message: INCIDENT.message,
      createdAt: INCIDENT.createdAt,
      model: {
        fileName: 'order-fulfillment.bpmn',
        settings: [],
        codeLabel: 'ScoringApiClient.java',
      },
    };
    const view: InstanceView = {
      ...withIncident(local),
      model: { fileName: 'order-fulfillment.bpmn' },
    };
    harness.publish({ status: 'ready', refreshing: false, view });
    const openCode = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[data-code-for="Activity_ReserveStock"]',
    );
    openCode.click();

    expect(openCode.title).toBe('Open ScoringApiClient.java');
    expect(harness.posted).toContainEqual({ type: 'openCode', elementId: 'Activity_ReserveStock' });
    expect(button(header(harness.root), 'Open model')).toBeUndefined();
  });

  it('shows the code of the clicked element once it is found', async () => {
    harness = mountApp();
    const view: InstanceView = {
      ...INSTANCE_WITH_CALLED_INCIDENT,
      model: { fileName: 'order-fulfillment.bpmn' },
    };
    harness.publish({ status: 'ready', refreshing: false, view });
    const hit = await waitForElement<SVGElement>(
      harness.root,
      'g.djs-element[data-element-id="Activity_ReserveStock"] .djs-hit',
    );

    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(harness.root.querySelector('[data-code-for="Activity_ReserveStock"]')).toBeNull();
    harness.publish({
      status: 'ready',
      refreshing: false,
      view: {
        ...view,
        model: {
          fileName: 'order-fulfillment.bpmn',
          code: { elementId: 'Activity_ReserveStock', label: 'ReserveStockWorker.java' },
        },
      },
    });
    const openCode = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[data-code-for="Activity_ReserveStock"]',
    );

    expect(harness.posted).toContainEqual({
      type: 'selectElement',
      elementId: 'Activity_ReserveStock',
    });
    expect(openCode.title).toBe('Open ReserveStockWorker.java');
  });

  it('has no model and code actions without a local model', async () => {
    harness = mountApp();
    harness.publish({ status: 'ready', refreshing: false, view: INSTANCE_WITH_CALLED_INCIDENT });
    const hit = await waitForElement<SVGElement>(
      harness.root,
      'g.djs-element[data-element-id="Activity_ReserveStock"] .djs-hit',
    );
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(harness.root.querySelector('[data-code-for]')).toBeNull();
    expect(button(header(harness.root), 'Open model')).toBeUndefined();
  });
});
