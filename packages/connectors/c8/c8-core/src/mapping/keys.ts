const DECIMAL = /^-?[0-9]{1,19}$/
const SMALLEST_LONG = -(2n ** 63n)
const LARGEST_LONG = 2n ** 63n - 1n

export class Keys {
  static isKey(value: string): boolean {
    return DECIMAL.test(value) && Keys.isLong(BigInt(value))
  }

  static only(values: readonly string[]): string[] {
    return values.filter((value) => Keys.isKey(value))
  }

  private static isLong(value: bigint): boolean {
    return value >= SMALLEST_LONG && value <= LARGEST_LONG
  }
}
