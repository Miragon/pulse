import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebviewIntent } from '../../src/core/protocol/index.js';
import { FIXTURES } from '../../dev/webview/fixtures/states.js';
import {
  buttonNamed,
  mountApp,
  nextFrame,
  press,
  waitForElement,
  type Harness,
} from './harness.js';

describe('the migration screen', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  function posted(type: WebviewIntent['type']) {
    return harness.posted.filter((intent) => intent.type === type);
  }

  async function open(fixture: keyof typeof FIXTURES, width = 1200): Promise<HTMLTableElement> {
    harness = mountApp({ width });
    harness.publish(FIXTURES[fixture]);
    return waitForElement<HTMLTableElement>(harness.root, 'table[aria-label="Mapping"]');
  }

  function selectOf(table: HTMLTableElement, label: string): HTMLSelectElement {
    const select = table.querySelector<HTMLSelectElement>(`select[aria-label="Map ${label} to"]`);
    if (select === null) {
      throw new Error(`no select for ${label}`);
    }
    return select;
  }

  it('shows both versions side by side with the mapping and the summary', async () => {
    const table = await open('migration');

    const diagrams = harness.root.querySelectorAll('.migration-diagram');
    expect(diagrams).toHaveLength(2);
    const [first, second] = [...diagrams].map((diagram) => diagram.getBoundingClientRect());
    expect(second!.left).toBeGreaterThan(first!.left);
    expect(table.tBodies[0]!.rows).toHaveLength(6);
    expect(harness.root.querySelector('.migration-actions__summary')?.textContent).toBe(
      'All 6 elements map by id · no problems · checked just now',
    );
  });

  it('stacks the diagrams in a narrow editor group', async () => {
    await open('migration', 700);
    await nextFrame();

    const [first, second] = [...harness.root.querySelectorAll('.migration-diagram')].map(
      (diagram) => diagram.getBoundingClientRect(),
    );
    expect(second!.top).toBeGreaterThan(first!.top);
    expect(second!.left).toBe(first!.left);
  });

  it('maps and unmaps through the select of a row, the keyboard path', async () => {
    const table = await open('migration');
    const select = selectOf(table, 'Approve order');

    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = 'Activity_ApproveOrder';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(posted('unmapElement')).toEqual([
      { type: 'unmapElement', sourceElementId: 'Activity_ApproveOrder' },
    ]);
    expect(posted('mapElement')).toEqual([
      {
        type: 'mapElement',
        sourceElementId: 'Activity_ApproveOrder',
        targetElementId: 'Activity_ApproveOrder',
      },
    ]);
  });

  it('replaces the migrate button with the refusal and offers to leave the instances out', async () => {
    const table = await open('migration-unmapped');

    expect(table.tBodies[0]!.rows[0]!.textContent).toContain('no mapping');
    expect(harness.root.querySelector('.migration-actions__refusal')?.textContent).toBe(
      '3 of 10 wait at Approve order, which has no mapping in v7.',
    );
    expect(() => buttonNamed(harness.root, 'Migrate 10 instances…')).toThrow();

    buttonNamed(harness.root, 'Leave the 3 out').click();

    expect(posted('leaveOutUnmapped')).toHaveLength(1);
  });

  it('starts the migration only from the button and picks the target from the header', async () => {
    await open('migration');

    buttonNamed(harness.root, 'Migrate 10 instances…').click();
    const picker = harness.root.querySelector<HTMLSelectElement>('select.version-picker__select')!;
    picker.value = 'order-fulfillment:5:0b7d';
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    expect(posted('startMigration')).toHaveLength(1);
    expect(posted('pickMigrationTarget')).toEqual([
      { type: 'pickMigrationTarget', definitionId: 'order-fulfillment:5:0b7d' },
    ]);
    expect(posted('selectVersion')).toEqual([]);
  });

  it('zooms only the diagram the keys were pressed in', async () => {
    await open('migration');
    const [source, target] = [...harness.root.querySelectorAll<HTMLElement>('.migration-diagram')];
    const zoomOf = (diagram: HTMLElement) => /\d+\s?%/.exec(diagram.textContent)?.[0];
    await vi.waitFor(() => {
      expect([zoomOf(source!), zoomOf(target!)]).not.toContain('100%');
    });
    await nextFrame();
    const before = [zoomOf(source!), zoomOf(target!)];

    press(source!.querySelector('.cd-shell-canvas')!, '=', { ctrlKey: true, metaKey: true });
    await nextFrame();

    await vi.waitFor(() => {
      expect(zoomOf(source!)).not.toBe(before[0]);
    });
    expect(zoomOf(target!)).toBe(before[1]);
  });

  it('marks the focused row for every theme and screen reader', async () => {
    const table = await open('migration');

    const focused = table.querySelector('tr.is-focused');
    expect(focused?.getAttribute('aria-current')).toBe('true');
    expect(getComputedStyle(focused!).outlineStyle).toBe('solid');
  });

  it('announces why the button is gone and keeps the whole reason in its tooltip', async () => {
    await open('migration-unmapped');

    const live = harness.root.querySelector('.migration-actions [aria-live="polite"]');
    expect(live?.textContent).toBe('3 of 10 wait at Approve order, which has no mapping in v7.');
    expect(harness.root.querySelector('.migration-actions__refusal')?.getAttribute('title')).toBe(
      '3 of 10 wait at Approve order, which has no mapping in v7.',
    );
    expect(
      harness.root.querySelector('.migration-actions__summary')?.getAttribute('aria-live'),
    ).toBeNull();
  });

  it('shows the shared bulk strip while the run goes on', async () => {
    await open('migration-running');

    expect(harness.root.querySelector('.bulk-strip')?.textContent).toContain(
      'Migrating instances: 4 of 10 done',
    );
    expect(harness.root.querySelector('.migration-actions__refusal')?.textContent).toBe(
      'Wait until migrating 10 instances ends.',
    );
  });
});

describe('the selection bar', () => {
  it('opens a migration for the selection', async () => {
    const harness = mountApp();
    harness.publish(FIXTURES['definition-selecting']);
    await waitForElement(harness.root, '.selection-bar');

    buttonNamed(harness.root, 'Migrate to version…').click();

    expect(harness.posted.filter((intent) => intent.type === 'openMigration')).toEqual([
      { type: 'openMigration' },
    ]);
    harness.unmount();
  });
});
