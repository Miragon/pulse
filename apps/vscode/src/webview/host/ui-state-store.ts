import { ColumnMeasure, type ColumnWidths } from '../components/column-measure.js';
import type { VsCodeApi } from './host-bridge.js';

export type InstanceTab = 'incidents' | 'waiting' | 'variables' | 'history';

export interface UiState {
  readonly instanceTab?: InstanceTab;
  readonly diagramShare?: number;
  readonly columnWidths?: Readonly<Record<string, ColumnWidths>>;
}

const UI_STATE_KEY = 'pulse';
const TABS: ReadonlySet<string> = new Set<InstanceTab>([
  'incidents',
  'waiting',
  'variables',
  'history',
]);

export class UiStateStore {
  static read(api: VsCodeApi): UiState {
    const part = UiStateStore.storedRecord(api)[UI_STATE_KEY];
    if (!UiStateStore.isRecord(part)) {
      return {};
    }
    const { instanceTab, diagramShare, columnWidths } = part;
    return {
      ...(typeof instanceTab === 'string' && TABS.has(instanceTab)
        ? { instanceTab: instanceTab as InstanceTab }
        : {}),
      ...(UiStateStore.isShare(diagramShare) ? { diagramShare } : {}),
      ...(UiStateStore.isRecord(columnWidths)
        ? { columnWidths: UiStateStore.validWidths(columnWidths) }
        : {}),
    };
  }

  static write(api: VsCodeApi, patch: UiState): void {
    const stored = UiStateStore.storedRecord(api);
    api.setState({ ...stored, [UI_STATE_KEY]: { ...UiStateStore.read(api), ...patch } });
  }

  static columnWidths(
    api: VsCodeApi,
    tableId: string,
    keys: readonly string[],
  ): ColumnWidths | undefined {
    const widths = UiStateStore.read(api).columnWidths?.[tableId];
    return keys.slice(0, -1).every((key) => widths?.[key] !== undefined) ? widths : undefined;
  }

  static writeColumnWidths(api: VsCodeApi, tableId: string, widths: ColumnWidths): void {
    UiStateStore.write(api, {
      columnWidths: { ...UiStateStore.read(api).columnWidths, [tableId]: widths },
    });
  }

  private static storedRecord(api: VsCodeApi): Record<string, unknown> {
    const stored = api.getState();
    return UiStateStore.isRecord(stored) ? stored : {};
  }

  private static validWidths(tables: Record<string, unknown>): Record<string, ColumnWidths> {
    return Object.fromEntries(
      Object.entries(tables).filter(
        (entry): entry is [string, ColumnWidths] =>
          UiStateStore.isRecord(entry[1]) &&
          Object.values(entry[1]).every((width) => ColumnMeasure.isWidth(width)),
      ),
    );
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static isShare(value: unknown): value is number {
    return typeof value === 'number' && value >= 0.15 && value <= 0.85;
  }
}
