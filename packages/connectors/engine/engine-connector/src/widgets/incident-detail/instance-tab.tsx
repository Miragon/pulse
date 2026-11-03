import { Card, CardContent, SectionHeading } from "@miragon/pulse-ui"

import type { IncidentDetailData } from "../../view-models.js"

import { ActivityNode, VariablesTable } from "../instance-sections.js"
import { useT } from "../../messages/use-t.js"

export function InstanceTab({ data, engineId }: { data: IncidentDetailData; engineId?: string }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      {data.activityTree && (
        <div>
          <SectionHeading title={t("incidentDetail.activityTreeTitle")} />
          <Card className="gap-0 py-0 shadow-none">
            <CardContent className="p-3">
              <ActivityNode node={data.activityTree} />
            </CardContent>
          </Card>
        </div>
      )}
      <div>
        <SectionHeading
          title={t("incidentDetail.variablesTitle")}
          hint={t("incidentDetail.variablesHint", {
            count: Object.keys(data.variables).length,
          })}
        />
        <VariablesTable
          variables={data.variables}
          instanceId={data.processInstanceId}
          engine={engineId}
          readOnly={data.instance.ended}
        />
      </div>
    </div>
  )
}
