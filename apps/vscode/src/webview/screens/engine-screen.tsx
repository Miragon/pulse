import type { ComponentChildren } from 'preact';
import type {
  EngineView,
  ProcessListFilter,
  ProcessRow,
  ProcessScope,
} from '../../core/protocol/index.js';
import { ContextBar, type Freshness } from '../components/context-bar.js';
import { DataTable, type Column } from '../components/data-table.js';
import { EmptyHint } from '../components/empty-hint.js';
import { HeaderButton } from '../components/header-button.js';
import { glyphs } from '../components/lucide-glyphs.json';
import { ScopeSegments, type ScopeOption } from '../components/scope-segments.js';
import { SearchField } from '../components/search-field.js';
import { WebUiButton } from '../components/web-ui-button.js';
import { CountLabels } from '../format/count-labels.js';
import { useHost } from '../host/host-context.js';

export interface EngineScreenProps {
  readonly view: EngineView;
  readonly freshness: Freshness;
  readonly problem?: ComponentChildren;
}

const PROCESS_SCOPES: readonly ScopeOption<ProcessScope>[] = [
  { scope: 'all', label: 'All' },
  { scope: 'withIncident', label: 'With incident' },
];

const COLUMNS: readonly Column<ProcessRow>[] = [
  {
    key: 'process',
    label: 'Process',
    render: (row) => (
      <>
        {row.name ?? row.bpmnProcessId}
        {row.name !== undefined && <code class="muted"> {row.bpmnProcessId}</code>}
      </>
    ),
  },
  { key: 'version', label: 'Latest version', render: (row) => `v${row.latestVersion}` },
  { key: 'running', label: 'Running', render: (row) => CountLabels.exact(row.running) },
  {
    key: 'withIncident',
    label: 'With incident',
    render: (row) => (
      <span class={row.withIncident > 0 ? 'danger-count' : undefined}>
        {CountLabels.exact(row.withIncident)}
      </span>
    ),
  },
];

function ProcessFilterBar({
  view,
  refreshing,
}: {
  readonly view: EngineView;
  readonly refreshing: boolean;
}) {
  const host = useHost();
  const { scope } = view.filter;
  const filter = (next: ProcessListFilter): void => {
    host.post({ type: 'filterProcesses', filter: next });
  };
  return (
    <div class="filter-bar">
      <ScopeSegments
        label="Show processes"
        options={PROCESS_SCOPES}
        checked={scope}
        counts={view.scopeCounts}
        busy={refreshing}
        onSelect={(next) => {
          filter({ ...view.filter, scope: next });
        }}
      />
      <SearchField
        applied={view.filter.search ?? ''}
        label="Search by name or BPMN process ID"
        placeholder="Name or key"
        onSearch={(search) => {
          filter(search === '' ? { scope } : { scope, search });
        }}
      />
      <span class="filter-bar__summary">{view.summary}</span>
    </div>
  );
}

export function EngineScreen({ view, freshness, problem }: EngineScreenProps) {
  const host = useHost();
  return (
    <div class="screen screen--with-strips">
      <ContextBar
        subject="engine"
        title={view.engine.name}
        engine={view.engine}
        freshness={freshness}
      >
        {view.engine.product !== undefined && (
          <span class="context-bar__key">{view.engine.product}</span>
        )}
        <HeaderButton
          icon={glyphs.RotateCcw}
          label="Refresh"
          title={`Read ${view.engine.name} again`}
          intent={{ type: 'refresh' }}
        />
        <WebUiButton link={view.webUi} />
      </ContextBar>
      <div class="strip-stack">{problem}</div>
      <section class="list-region" aria-label="Processes">
        <ProcessFilterBar view={view} refreshing={freshness.kind === 'refreshing'} />
        <DataTable
          label="Processes"
          resizeId="processes"
          columns={COLUMNS}
          rows={view.processes}
          rowKey={(row) => row.bpmnProcessId}
          actions={{
            onActivate: (row, toSide) => {
              host.post({ type: 'openProcess', bpmnProcessId: row.bpmnProcessId, toSide });
            },
            onCopy: (row) => {
              host.post({ type: 'copy', text: row.bpmnProcessId, label: 'BPMN process ID' });
            },
          }}
          empty={<EmptyHint text={view.emptyText} />}
        />
      </section>
    </div>
  );
}
