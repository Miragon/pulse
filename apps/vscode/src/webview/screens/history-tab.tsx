import type { PathRow, PathState } from '../../core/protocol/index.js';
import { DataTable } from '../components/data-table.js';
import type { Column } from '../components/data-table.js';
import { EmptyHint } from '../components/empty-hint.js';
import { TimeCell } from './waiting-tab.js';

export interface HistoryTabProps {
  readonly path: readonly PathRow[];
  readonly elementName: (elementId: string) => string;
}

const STATE_LABELS: Readonly<Record<PathState, string>> = {
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

export function HistoryTab({ path, elementName }: HistoryTabProps) {
  const columns: readonly Column<PathRow>[] = [
    {
      key: 'element',
      label: 'Element',
      render: (row) => row.elementName ?? elementName(row.elementId),
    },
    {
      key: 'state',
      label: 'State',
      render: (row) => (
        <span class={`path-state path-state--${row.state}`}>{STATE_LABELS[row.state]}</span>
      ),
    },
    { key: 'started', label: 'Started', render: (row) => <TimeCell iso={row.startedAt} precise /> },
    { key: 'ended', label: 'Ended', render: (row) => <TimeCell iso={row.endedAt} precise /> },
    {
      key: 'duration',
      label: 'Duration',
      render: (row) => row.duration ?? <span class="muted">–</span>,
    },
  ];
  return (
    <DataTable
      label="History"
      resizeId="history"
      columns={columns}
      rows={path}
      rowKey={(row) => `${row.elementId}:${row.startedAt}`}
      empty={<EmptyHint text="The engine keeps no history for this instance." />}
    />
  );
}
