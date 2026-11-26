export class FewAtOnce {
  static readonly READS = 8

  static async map<Item, Result>(
    items: readonly Item[],
    work: (item: Item) => Promise<Result>,
  ): Promise<Result[]> {
    const results = new Array<Result>(items.length)
    const queue = items.entries()
    let failed = false
    const worker = async (): Promise<void> => {
      for (const [index, item] of queue) {
        if (failed) {
          return
        }
        try {
          results[index] = await work(item)
        } catch (error: unknown) {
          failed = true
          throw error
        }
      }
    }
    await Promise.all(Array.from({ length: FewAtOnce.READS }, worker))
    return results
  }
}
