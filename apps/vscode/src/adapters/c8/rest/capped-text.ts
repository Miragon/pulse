export class CappedText {
  constructor(private readonly maxBytes: number) {}

  async read(response: Response): Promise<string | undefined> {
    if (Number(response.headers.get("Content-Length") ?? 0) > this.maxBytes) {
      void response.body?.cancel().catch(() => undefined)
      return undefined
    }
    return response.body === null ? "" : this.readAll(response.body.getReader())
  }

  private async readAll(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<string | undefined> {
    const decoder = new TextDecoder()
    let text = ""
    let total = 0
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      total += read.value.byteLength
      if (total > this.maxBytes) {
        void reader.cancel().catch(() => undefined)
        return undefined
      }
      text += decoder.decode(read.value, { stream: true })
    }
    return text + decoder.decode()
  }
}
