export interface MoveTarget {
  readonly elementId: string;
  readonly label: string;
  readonly effects: readonly string[];
  readonly warnings: readonly string[];
}

export interface RefusedTarget {
  readonly elementId: string;
  readonly label: string;
  readonly reason: string;
}

export interface MoveOption {
  readonly fromElementId: string;
  readonly fromLabel: string;
  readonly targets: readonly MoveTarget[];
  readonly refused: readonly RefusedTarget[];
}
