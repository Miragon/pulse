import type { useT } from "../../messages/use-t.js"

/** A process a view names: its key, its name where it has one, its tenant where it has one. */
interface NamedProcess {
  readonly processDefinitionKey: string
  readonly processDefinitionName: string | null
  readonly tenantId?: string | undefined
}

/**
 * A process by its name, else its key; in a tenant, the tenant named beside it, so two processes of
 * one key read apart ("Label · Tenant north").
 */
export function processNameInTenant(process: NamedProcess, t: ReturnType<typeof useT>): string {
  const name = process.processDefinitionName ?? process.processDefinitionKey
  return process.tenantId === undefined
    ? name
    : t("cockpit.crumb.processInTenant", { process: name, tenant: process.tenantId })
}
