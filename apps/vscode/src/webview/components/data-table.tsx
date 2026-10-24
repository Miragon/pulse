import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ColumnMeasure } from './column-measure.js';
import { ColumnGrip, useColumnSizing, type ColumnSizing } from './column-sizing.js';
import { TableKeys } from './table-keys.js';

export interface Column<Row> {
  readonly key: string;
  readonly label: string;
  readonly render: (row: Row) => ComponentChildren;
  readonly header?: ComponentChildren;
  readonly width?: number;
}

interface RowActions<Row> {
  readonly onActivate: (row: Row, toSide: boolean) => void;
  readonly onCopy?: (row: Row) => void;
  readonly onToggle?: (row: Row) => void;
}

export interface DataTableProps<Row> {
  readonly label: string;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly actions?: RowActions<Row>;
  readonly empty: ComponentChildren;
  readonly skeletonRows?: number;
  readonly footer?: ComponentChildren;
  readonly resizeId?: string;
}

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last,
};

function useRowKeys<Row>(
  rows: readonly Row[],
  rowKey: (row: Row) => string,
  actions: RowActions<Row> | undefined,
) {
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const found = rows.findIndex((row) => rowKey(row) === activeKey);
  const active = found === -1 ? 0 : found;
  const setActive = (index: number): void => {
    const row = rows[index];
    setActiveKey(row === undefined ? undefined : rowKey(row));
  };
  const onKeyDown = (event: KeyboardEvent, row: Row, index: number): void => {
    const move = MOVES[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const next = move(index, rows.length - 1);
      setActive(next);
      TableKeys.focusRow(event.currentTarget, next);
    } else if (event.key === 'Enter') {
      actions?.onActivate(row, TableKeys.wantsSide(event));
    } else if (event.key === ' ' && actions?.onToggle !== undefined) {
      event.preventDefault();
      actions.onToggle(row);
    } else if (TableKeys.isCopy(event) && actions?.onCopy !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      actions.onCopy(row);
    }
  };
  return { active, setActive, onKeyDown };
}

function SkeletonBody({ columns, count }: { readonly columns: number; readonly count: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: count }, (_row, rowIndex) => (
        <tr key={rowIndex} class="data-table__skeleton">
          {Array.from({ length: columns }, (_cell, cellIndex) => (
            <td key={cellIndex}>
              <span class="skeleton-bar" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function useFocusKeptInBody(rows: readonly unknown[]) {
  const body = useRef<HTMLTableSectionElement>(null);
  const focusedIndex = useRef<number | undefined>(undefined);
  useEffect(() => {
    const forget = (): void => {
      focusedIndex.current = undefined;
    };
    const forgetOutside = (event: Event): void => {
      if (!(event.target instanceof Node && body.current?.contains(event.target))) {
        forget();
      }
    };
    document.addEventListener('focusin', forgetOutside);
    document.addEventListener('pointerdown', forgetOutside, true);
    window.addEventListener('blur', forget);
    return () => {
      document.removeEventListener('focusin', forgetOutside);
      document.removeEventListener('pointerdown', forgetOutside, true);
      window.removeEventListener('blur', forget);
    };
  }, []);
  useLayoutEffect(() => {
    const element = body.current;
    const index = focusedIndex.current;
    if (
      element === null ||
      index === undefined ||
      !document.hasFocus() ||
      element.contains(document.activeElement)
    ) {
      return;
    }
    const next = element.rows[Math.min(index, element.rows.length - 1)];
    if (next === undefined) {
      focusedIndex.current = undefined;
    } else {
      next.focus();
    }
  }, [rows]);
  return {
    body,
    focused: (index: number) => {
      focusedIndex.current = index;
    },
  };
}

function RowsBody<Row>({ columns, rows, rowKey, actions }: DataTableProps<Row>) {
  const keys = useRowKeys(rows, rowKey, actions);
  const focus = useFocusKeptInBody(rows);
  const interactive = actions !== undefined;
  return (
    <tbody ref={focus.body}>
      {rows.map((row, index) => (
        <tr
          key={rowKey(row)}
          class={interactive ? 'data-table__row data-table__row--interactive' : 'data-table__row'}
          tabIndex={interactive ? (index === keys.active ? 0 : -1) : undefined}
          onFocus={() => {
            keys.setActive(index);
            focus.focused(index);
          }}
          onKeyDown={(event) => {
            keys.onKeyDown(event, row, index);
          }}
          onClick={(event) => actions?.onActivate(row, TableKeys.wantsSide(event))}
        >
          {columns.map((column) => (
            <td key={column.key}>{column.render(row)}</td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function HeaderRow<Row>({
  columns,
  sizing,
}: {
  readonly columns: readonly Column<Row>[];
  readonly sizing: ColumnSizing | undefined;
}) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => (
          <th key={column.key} scope="col" data-key={column.key}>
            {column.header ?? <span class="data-table__label">{column.label}</span>}
            {sizing !== undefined && column.width === undefined && index < columns.length - 1 && (
              <ColumnGrip label={column.label} columnKey={column.key} sizing={sizing} />
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function FixedColumns<Row>({
  columns,
  widths,
}: {
  readonly columns: readonly Column<Row>[];
  readonly widths: Readonly<Record<string, number>>;
}) {
  return (
    <colgroup>
      {columns.map((column) => {
        const width = column.width ?? widths[column.key];
        return (
          <col key={column.key} style={width === undefined ? undefined : { width: `${width}px` }} />
        );
      })}
    </colgroup>
  );
}

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { label, columns, rows, skeletonRows, empty, footer, resizeId } = props;
  const sizing = useColumnSizing(
    resizeId,
    columns.filter((column) => column.width === undefined).map((column) => column.key),
  );
  const fixed = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const { widths } = sizing;
  const showEmpty = skeletonRows === undefined && rows.length === 0;
  return (
    <div class={widths === undefined ? 'data-table' : 'data-table data-table--fixed'}>
      <table
        aria-label={label}
        style={
          widths === undefined
            ? undefined
            : { minWidth: `${ColumnMeasure.tableWidth(widths, fixed)}px` }
        }
        onPointerOver={(event) => {
          ColumnMeasure.offerTitle(event);
        }}
      >
        {widths !== undefined && <FixedColumns columns={columns} widths={widths} />}
        {skeletonRows === undefined && (
          <HeaderRow columns={columns} sizing={resizeId === undefined ? undefined : sizing} />
        )}
        {skeletonRows === undefined ? (
          <RowsBody {...props} />
        ) : (
          <SkeletonBody columns={columns.length} count={skeletonRows} />
        )}
      </table>
      {showEmpty && <div class="data-table__empty">{empty}</div>}
      {footer !== undefined && <div class="data-table__footer">{footer}</div>}
    </div>
  );
}
