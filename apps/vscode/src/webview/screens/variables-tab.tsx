import { useCallback, useState } from 'preact/hooks';
import { glyphs } from '../components/lucide-glyphs.json';
import type { VariableRow } from '../../core/protocol/index.js';
import { CopyButton } from '../components/copy-button.js';
import { DataTable } from '../components/data-table.js';
import type { Column } from '../components/data-table.js';
import { EmptyHint } from '../components/empty-hint.js';
import { Icon } from '../components/icon.js';
import { useWriteState } from '../host/write-context.js';
import { WriteStates } from '../host/write-states.js';
import { VariableEditor } from './variable-editor.js';
import { VariableValueText } from './variable-value-text.js';

export interface VariablesTabProps {
  readonly variables: readonly VariableRow[];
  readonly elementName: (elementId: string) => string;
}

interface Editing {
  readonly name: string | undefined;
  readonly open: (name: string) => void;
  readonly close: () => void;
}

function EditButton({ row, editing }: { readonly row: VariableRow; readonly editing: Editing }) {
  const write = useWriteState();
  return (
    <button
      type="button"
      class="icon-button icon-button--small value-cell__edit"
      aria-label={`Edit ${row.name}`}
      title={`Edit ${row.name}`}
      disabled={WriteStates.isWriting(write)}
      onClick={(event) => {
        event.stopPropagation();
        editing.open(row.name);
      }}
    >
      <Icon of={glyphs.Pencil} />
    </button>
  );
}

function ValueCell({ row, editing }: { readonly row: VariableRow; readonly editing: Editing }) {
  const [open, setOpen] = useState(false);
  const expandable = VariableValueText.isExpandable(row);
  const cutOff = row.truncated ? ' (cut off)' : '';
  return (
    <div class={`value-cell${open ? ' value-cell--open' : ''}`}>
      {expandable && (
        <button
          type="button"
          class="icon-button icon-button--small"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} the value of ${row.name}`}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <Icon of={open ? glyphs.ChevronDown : glyphs.ChevronRight} />
        </button>
      )}
      {open ? (
        <pre class="value-cell__full">{VariableValueText.readable(row)}</pre>
      ) : (
        <code class="value-cell__line" title={`${row.valueJson}${cutOff}`}>
          {row.valueJson}
        </code>
      )}
      {row.truncated && <span class="muted value-cell__cut">cut off</span>}
      <CopyButton
        text={row.valueJson}
        label={`value of ${row.name}${cutOff}`}
        class="value-cell__copy"
      />
      {row.editor !== undefined && <EditButton row={row} editing={editing} />}
    </div>
  );
}

function ValueOrEditor({
  row,
  editing,
  elementName,
}: {
  readonly row: VariableRow;
  readonly editing: Editing;
  readonly elementName: (elementId: string) => string;
}) {
  if (row.editor !== undefined && editing.name === row.name) {
    const shadows = (row.shadowedAt ?? []).map(elementName).join(', ');
    return (
      <VariableEditor
        row={row}
        editor={row.editor}
        shadowedBy={shadows === '' ? undefined : shadows}
        onClose={editing.close}
      />
    );
  }
  return <ValueCell row={row} editing={editing} />;
}

function NameCell({
  row,
  elementName,
}: {
  readonly row: VariableRow;
  readonly elementName: (elementId: string) => string;
}) {
  const shadows = (row.shadowedAt ?? []).map(elementName).join(', ');
  return (
    <span class="variable-name">
      <code>{row.name}</code>
      {shadows !== '' && (
        <span
          class="variable-name__shadow"
          title={`${shadows} keeps its own ${row.name}; changing this one does not reach it.`}
          aria-label={`${shadows} keeps its own ${row.name}`}
        >
          <Icon of={glyphs.TriangleAlert} size={12} />
        </span>
      )}
    </span>
  );
}

function useEditing(): Editing {
  const [name, setName] = useState<string | undefined>(undefined);
  const close = useCallback(() => {
    setName((closing) => {
      if (closing !== undefined) {
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[aria-label="${CSS.escape(`Edit ${closing}`)}"]`)
            ?.focus();
        });
      }
      return undefined;
    });
  }, []);
  return { name, open: setName, close };
}

export function VariablesTab({ variables, elementName }: VariablesTabProps) {
  const editing = useEditing();
  const columns: readonly Column<VariableRow>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => <NameCell row={row} elementName={elementName} />,
    },
    { key: 'type', label: 'Type', render: (row) => row.type ?? <span class="muted">–</span> },
    {
      key: 'value',
      label: 'Value',
      render: (row) => <ValueOrEditor row={row} editing={editing} elementName={elementName} />,
    },
    {
      key: 'scope',
      label: 'Scope',
      render: (row) =>
        row.scopeElementId === undefined ? 'Process' : elementName(row.scopeElementId),
    },
  ];
  return (
    <DataTable
      label="Variables"
      resizeId="variables"
      columns={columns}
      rows={variables}
      rowKey={(row) => `${row.scopeElementId ?? ''}:${row.name}`}
      empty={<EmptyHint text="This instance has no variables." />}
    />
  );
}
