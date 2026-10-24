import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const OPERATE_CLI_PATH = fileURLToPath(
  import.meta.resolve("@miragon/operate/dist/operate.js"),
)

export interface EngineCliConfig {
  readonly path: string
  remove(): Promise<void>
}

export async function writeEngineCliConfig(): Promise<EngineCliConfig> {
  const directory = await mkdtemp(join(tmpdir(), "pulse-engine-cli-"))
  const path = join(directory, "engine-cli-config.json")
  await writeFile(path, JSON.stringify({ profiles: {} }))
  return { path, remove: () => rm(directory, { recursive: true, force: true }) }
}
