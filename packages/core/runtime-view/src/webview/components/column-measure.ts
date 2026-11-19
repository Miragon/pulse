export type ColumnWidths = Readonly<Record<string, number>>

export class ColumnMeasure {
  static readonly MIN = 48
  static readonly MAX = 2000

  static isWidth(value: unknown): value is number {
    return typeof value === "number" && value >= ColumnMeasure.MIN && value <= ColumnMeasure.MAX
  }
}
