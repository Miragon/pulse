import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFINITION_VIEW } from '../../dev/webview/fixtures/definition.js';
import { FIXTURES } from '../../dev/webview/fixtures/states.js';
import { mountApp, nextFrame, waitForElement } from './harness.js';
import type { Harness } from './harness.js';

const BADGES = '.djs-overlays[data-container-id="Activity_ShipOrder"]';

describe('definition screen', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('draws the deployed diagram and puts the incident badge on its element', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);

    const incident = await waitForElement(harness.root, `${BADGES} [data-variant="incident"]`);

    expect(incident.textContent).toBe('1');
    const reserveStock = harness.root.querySelector(
      '.djs-overlays[data-container-id="Activity_ReserveStock"]',
    );
    expect(reserveStock?.querySelector('[data-variant="incident"]')).toBeNull();
    expect(reserveStock?.querySelector('[data-variant="running"]')?.textContent).toBe('1');
    expect(
      harness.root.querySelector('g.djs-element[data-element-id="Activity_ShipOrder"]')?.classList,
    ).toContain('pulse-incident');
  });

  it('filters the instances to an element when the element is clicked', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const hit = await waitForElement<SVGElement>(
      harness.root,
      'g.djs-element[data-element-id="Activity_ApproveOrder"] .djs-hit',
    );

    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(harness.posted).toContainEqual({
      type: 'filterInstances',
      filter: { scope: 'running', elementId: 'Activity_ApproveOrder' },
    });
  });

  it('frames the canvas on keyboard focus only, not after a click on an element', async () => {
    await page.viewport(1300, 900);
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const hit = await waitForElement<SVGElement>(
      harness.root,
      'g.djs-element[data-element-id="Activity_ApproveOrder"] .djs-hit',
    );
    const canvas = harness.root.querySelector<SVGSVGElement>('.djs-container > svg')!;

    await userEvent.click(hit);
    expect(document.activeElement).toBe(canvas);
    expect(getComputedStyle(canvas).outlineStyle).toBe('none');

    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(canvas);
    expect(getComputedStyle(canvas).outlineStyle).toBe('solid');
  });

  it('keeps the canvas unframed when the panel loses and regains the focus after a click', async () => {
    await page.viewport(1300, 900);
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const hit = await waitForElement<SVGElement>(
      harness.root,
      'g.djs-element[data-element-id="Activity_ApproveOrder"] .djs-hit',
    );
    const canvas = harness.root.querySelector<SVGSVGElement>('.djs-container > svg')!;
    await userEvent.click(hit);

    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    canvas.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(document.activeElement).toBe(canvas);
    expect(getComputedStyle(canvas).outlineStyle).toBe('none');
  });

  it('filters the instances to an element and the scope of the clicked badge count', async () => {
    harness = mountApp();
    harness.publish({
      ...FIXTURES.definition,
      view: { ...DEFINITION_VIEW, filter: { scope: 'ended' } },
    });
    const cluster = await waitForElement<HTMLElement>(
      harness.root,
      '[data-badge-for="Activity_CheckCredit"]',
    );
    const running = cluster.querySelector<HTMLButtonElement>('[data-scope="running"]')!;
    const propagated = cluster.querySelector<HTMLButtonElement>('[data-scope="withIncident"]')!;

    running.click();
    propagated.click();

    expect(running.title).toBe(
      'Check credit: 5 instances running. Show the running instances here.',
    );
    expect(propagated.title).toBe(
      'Check credit: 2 incidents in called instances. Show the instances with an incident here.',
    );
    expect(harness.posted).toContainEqual({
      type: 'filterInstances',
      filter: { scope: 'running', elementId: 'Activity_CheckCredit' },
    });
    expect(harness.posted).toContainEqual({
      type: 'filterInstances',
      filter: { scope: 'withIncident', elementId: 'Activity_CheckCredit' },
    });
  });

  it('keeps the viewbox and the overlays when the theme switches', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const badge = await waitForElement(harness.root, `${BADGES} [data-variant="incident"]`);
    await nextFrame();
    const viewport = harness.root.querySelector('svg .viewport');
    const transformBefore = viewport?.getAttribute('transform');
    const task = harness.root.querySelector<SVGElement>(
      'g.djs-element[data-element-id="Activity_ReserveStock"] .djs-visual > rect',
    );
    expect(task === null ? '' : getComputedStyle(task).fill).toBe('rgb(255, 255, 255)');

    document.documentElement.dataset.cdTheme = 'dark';
    await nextFrame();

    expect(harness.root.querySelector('svg .viewport')).toBe(viewport);
    expect(viewport?.getAttribute('transform')).toBe(transformBefore);
    expect(badge.isConnected).toBe(true);
    expect(task === null ? '' : getComputedStyle(task).fill).toBe('rgb(29, 29, 29)');
  });

  it('updates the badges without importing the diagram again', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, `${BADGES} [data-variant="incident"]`);
    const svg = harness.root.querySelector('svg');

    harness.publish({
      status: 'ready',
      refreshing: false,
      view: {
        ...DEFINITION_VIEW,
        badges: [
          {
            elementId: 'Activity_ShipOrder',
            running: 4,
            incidents: 0,
            incidentsInCalledInstances: 0,
          },
        ],
      },
    });

    await vi.waitFor(() => {
      expect(harness.root.querySelector(`${BADGES} [data-variant="running"]`)?.textContent).toBe(
        '4',
      );
    });
    expect(harness.root.querySelector(`${BADGES} [data-variant="incident"]`)).toBeNull();
    expect(harness.root.querySelector('svg')).toBe(svg);
  });

  it('keeps the view while it refreshes', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, `${BADGES} [data-variant="incident"]`);

    harness.publish(FIXTURES.refreshing);

    await vi.waitFor(() => {
      expect(harness.root.querySelector('.freshness')?.textContent).toBe('Refreshing…');
    });
    expect(harness.root.querySelector(`${BADGES} [data-variant="incident"]`)).not.toBeNull();
    expect(harness.root.querySelectorAll('.data-table__row')).toHaveLength(
      DEFINITION_VIEW.instances.length,
    );
  });
});
