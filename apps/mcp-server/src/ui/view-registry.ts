import type { ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"
import { analyticsViews } from "@miragon/pulse-analytics-connector/widgets"

/** Every view of this server by view name (= its view tool's name); `test/view-registry.test.ts` holds it to the goldens. */
export const viewRegistry: ViewMap = {
  ...engineViews,
  ...analyticsViews,
}
