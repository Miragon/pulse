import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineView, PanelState } from '../../src/core/protocol/index.js';
import { ENGINE_VIEW } from '../../dev/webview/fixtures/engine.js';
import { PROD_ENGINE } from '../../dev/webview/fixtures/engines.js';
import { buttonNamed, mountApp, press, radioNamed, waitForElement } from './harness.js';
import type { Harness } from './harness.js';

function ready(view: EngineView, refreshing = false): PanelState {
  return { status: 'ready', view, refreshing };
}

function rows(root: HTMLElement): HTMLTableRowElement[] {
  return [...root.querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

function cells(row: HTMLTableRowElement | undefined): string[] {
  return [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
}

describe('the engine overview', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('names the engine, its product, access and freshness, and refreshes on request', async () => {
    harness = mountApp();
    harness.publish(ready(ENGINE_VIEW));
    const bar = await waitForElement(harness.root, '.context-bar');

    buttonNamed(bar, 'Refresh').click();
    buttonNamed(bar, 'Open in Cockpit').click();

    expect(bar.querySelector('h1')?.textContent).toBe('shop-dev');
    expect(bar.querySelector('.context-bar__key')?.textContent).toBe('Operaton 2.1.5');
    expect(bar.textContent).not.toContain('LOCAL');
    expect(bar.textContent).toContain('Writable');
    expect(bar.textContent).toContain('As of');
    expect(buttonNamed(bar, 'Refresh').title).toBe('Read shop-dev again');
    expect(harness.posted).toEqual([{ type: 'refresh' }, { type: 'openWebUi' }]);
  });

  it('lists the processes with their latest version and counts, incidents in red', async () => {
    harness = mountApp();
    harness.publish(ready(ENGINE_VIEW));
    await waitForElement(harness.root, 'tbody tr');

    const [order, , shipment] = rows(harness.root);

    expect([...harness.root.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual([
      'Process',
      'Latest version',
      'Running',
      'With incident',
    ]);
    expect(cells(order)).toEqual(['Order fulfillment order-fulfillment', 'v3', '150', '9']);
    expect(cells(shipment)).toEqual(['shipment', 'v1', '1,204', '0']);
    expect(order?.querySelector('.danger-count')?.textContent).toBe('9');
    expect(shipment?.querySelector('.danger-count')).toBeNull();
    expect(harness.root.querySelector('.filter-bar__summary')?.textContent).toBe(
      '3 processes · 1369 running · 10 with incident',
    );
  });

  it('opens a process on click, to the side with Ctrl or Cmd, and from the keyboard', async () => {
    harness = mountApp();
    harness.publish(ready(ENGINE_VIEW));
    await waitForElement(harness.root, 'tbody tr');
    const [order, returns] = rows(harness.root);

    order?.click();
    order?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    order?.focus();
    press(order!, 'ArrowDown');
    press(document.activeElement!, 'Enter', { metaKey: true });
    press(document.activeElement!, 'c', { ctrlKey: true });

    expect(document.activeElement).toBe(returns);
    expect(harness.posted).toEqual([
      { type: 'openProcess', bpmnProcessId: 'order-fulfillment', toSide: false },
      { type: 'openProcess', bpmnProcessId: 'order-fulfillment', toSide: true },
      { type: 'openProcess', bpmnProcessId: 'return-handling', toSide: true },
      { type: 'copy', text: 'return-handling', label: 'BPMN process ID' },
    ]);
  });

  it('filters by scope and by a search on name or key, with counts', async () => {
    harness = mountApp();
    harness.publish(ready(ENGINE_VIEW));
    const group = await waitForElement(harness.root, '[role="radiogroup"]');

    radioNamed(harness.root, 'With incident').click();
    const search = harness.root.querySelector<HTMLInputElement>('.search-field input')!;
    search.value = '  order ';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(harness.posted.filter((intent) => intent.type === 'filterProcesses')).toHaveLength(2);
    });

    expect(group.getAttribute('aria-label')).toBe('Show processes');
    expect(radioNamed(harness.root, 'All').textContent).toBe('All 3');
    expect(radioNamed(harness.root, 'With incident').textContent).toBe('With incident 2');
    expect(group.querySelector('.segmented__count--danger')?.textContent).toBe('2');
    expect(harness.posted).toEqual([
      { type: 'filterProcesses', filter: { scope: 'withIncident' } },
      { type: 'filterProcesses', filter: { scope: 'all', search: 'order' } },
    ]);
  });

  it('drops an emptied search and keeps the scope it shows', async () => {
    harness = mountApp();
    harness.publish(ready({ ...ENGINE_VIEW, filter: { scope: 'withIncident', search: 'order' } }));
    const search = await waitForElement<HTMLInputElement>(harness.root, '.search-field input');
    expect(search.value).toBe('order');

    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(harness.posted).toEqual([
        { type: 'filterProcesses', filter: { scope: 'withIncident' } },
      ]);
    });
  });

  it('says what the engine gave when no process is listed', async () => {
    harness = mountApp();
    harness.publish(
      ready({
        ...ENGINE_VIEW,
        processes: [],
        scopeCounts: { all: 0, withIncident: 0 },
        emptyText: 'No processes deployed on shop-dev.',
      }),
    );

    const empty = await waitForElement(harness.root, '.data-table__empty');

    expect(empty.textContent).toBe('No processes deployed on shop-dev.');
    expect(rows(harness.root)).toEqual([]);
  });

  it('offers Set credentials when the engine rejected them', async () => {
    harness = mountApp();
    harness.publish({
      status: 'failed',
      engine: PROD_ENGINE,
      problem: {
        title: 'prod-eu rejected the credentials.',
        detail: 'HTTP 401.',
        canEditConnection: true,
        needsCredentials: true,
      },
    });
    await waitForElement(harness.root, '.status-box');

    buttonNamed(harness.root, 'Set credentials…').click();

    expect(
      [...harness.root.querySelectorAll('.status-box button')].map((b) => b.textContent),
    ).toEqual(['Reconnect', 'Set credentials…']);
    expect(harness.posted).toEqual([{ type: 'setCredentials' }]);
  });
});
