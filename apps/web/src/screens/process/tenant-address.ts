import { useEffect } from "react"
import { useQueryClient, useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import { PROCESS_SCREEN_FEED, processScreenKey, type ProcessScreenFeed } from "./process-feed.js"
import { processArgsOf, type ScreenProcess } from "./screen-process.js"

/**
 * The address of a process named by its key alone gives way to the address of the process the
 * screen shows (F17, the address rule: a released address stays readable and gives way to the new
 * one in its entry). The process screen's feed reads a key without a tenant as the process
 * engine-core's `ProcessTenants` names on every surface (the key's process without a tenant, else
 * its first tenant by id) and names that tenant in its answer; where it names one, the answer is
 * kept under the read of the process in that tenant too, so the screen reads nothing again, and
 * `onTenant` names the tenant, which the page writes into the address as `?tenant=`. It reads
 * nothing itself: it follows the screen's own read of the process.
 */
export function useTenantAddress(
  engine: string,
  process: ScreenProcess,
  version: number | undefined,
  onTenant: (tenantId: string) => void,
): void {
  const client = useQueryClient()
  const read = useToolQuery<ProcessScreenFeed>(
    processScreenKey(engine, process),
    PROCESS_SCREEN_FEED,
    processArgsOf(engine, process, version),
    { enabled: false },
  )
  const answer = process.tenantId === undefined ? read.data : undefined
  const tenantId = answer?.tenantId
  const readAt = read.dataUpdatedAt
  useEffect(() => {
    if (answer === undefined || tenantId === undefined) return
    const named = { key: process.key, tenantId }
    const key = [...processScreenKey(engine, named), processArgsOf(engine, named, version)]
    client.setQueryData(key, answer, { updatedAt: readAt })
    onTenant(tenantId)
  }, [client, engine, process.key, version, answer, tenantId, readAt, onTenant])
}
