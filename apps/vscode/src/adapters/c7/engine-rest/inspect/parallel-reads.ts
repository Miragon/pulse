const PARALLEL = 8
const IDS_PER_REQUEST = 50

export class ParallelReads {
  static async map<Item, Result>(
    items: readonly Item[],
    read: (item: Item) => Promise<Result>,
  ): Promise<Result[]> {
    const results: Result[] = []
    for (let start = 0; start < items.length; start += PARALLEL) {
      results.push(...(await Promise.all(items.slice(start, start + PARALLEL).map(read))))
    }
    return results
  }

  static async byIds<Result>(
    ids: readonly string[],
    read: (idList: string) => Promise<readonly Result[]>,
  ): Promise<Result[]> {
    const chunks: string[] = []
    for (let start = 0; start < ids.length; start += IDS_PER_REQUEST) {
      chunks.push(ids.slice(start, start + IDS_PER_REQUEST).join(","))
    }
    return (await ParallelReads.map(chunks, read)).flat()
  }
}
