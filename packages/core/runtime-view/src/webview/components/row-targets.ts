import type { DataTableProps as KitDataTableProps } from "@miragon/pulse-ui"

export interface RowActions<Row> {
  readonly onActivate: (row: Row, toSide: boolean) => void
  readonly rowLabel?: (row: Row) => string
  readonly onCopy?: (row: Row) => void
  readonly copyHint?: string
  readonly onToggle?: (row: Row) => void
}

type KitRowTargets<Row> = Pick<
  KitDataTableProps<Row>,
  "onActivate" | "rowLabel" | "onCopy" | "copyHint"
>

export class RowTargets {
  static kit<Row>(actions: RowActions<Row> | undefined): KitRowTargets<Row> {
    if (actions === undefined) {
      return {}
    }
    return {
      onActivate: (row, how) => {
        actions.onActivate(row, how.toSide)
      },
      ...(actions.rowLabel === undefined ? {} : { rowLabel: actions.rowLabel }),
      ...(actions.onCopy === undefined ? {} : { onCopy: actions.onCopy }),
      ...(actions.copyHint === undefined ? {} : { copyHint: actions.copyHint }),
    }
  }
}
