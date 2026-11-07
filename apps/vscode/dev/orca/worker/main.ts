import type { OrcaWorkerApi } from "orca/worker"
import { PulseWorker } from "./pulse-worker.js"

export default function activate(orca: OrcaWorkerApi): void {
  if (!("rawJSON" in JSON)) {
    orca.log("Pulse needs a worker Node with JSON.rawJSON (Node 21 or later).")
    return
  }
  new PulseWorker(orca).start()
}
