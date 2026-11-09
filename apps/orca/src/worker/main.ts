import type { OrcaWorkerApi } from "orca/worker"
import { PulseWorker } from "./pulse-worker.js"

let running: PulseWorker | undefined

function activate(orca: OrcaWorkerApi): void {
  if (!("rawJSON" in JSON)) {
    orca.log("Pulse needs a worker Node with JSON.rawJSON (Node 21 or later).")
    return
  }
  running = new PulseWorker(orca)
  running.start()
}

export function deactivate(): void {
  running?.stop()
  running = undefined
}

export default activate
