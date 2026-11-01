/** Constants so a tool rename trips a TS error at every call site. */
// The show tools; each one's name is also its view's name (`views.tsx`).
export const ANALYTICS_SHOW_DASHBOARD = "analytics_show_dashboard"
export const ANALYTICS_SHOW_PERIOD_COMPARE = "analytics_show_period_compare"
export const ANALYTICS_SHOW_VERSION_COMPARE = "analytics_show_version_compare"
export const ANALYTICS_SHOW_ENGINE_COMPARE = "analytics_show_engine_compare"
export const ANALYTICS_SHOW_ENGINE_LANDSCAPE = "analytics_show_engine_landscape"
export const ANALYTICS_SHOW_BPMN_HEATMAP = "analytics_show_bpmn_heatmap"
// camunda7's process-incidents flow references this by raw string: keep it stable.
export const ANALYTICS_BPMN_HEATMAP_DATA = "analytics_bpmn_heatmap_data"
// Kept out of the heat payload, so the model never reads the XML.
export const ANALYTICS_BPMN_XML_DATA = "analytics_bpmn_xml_data"
// camunda7 probes this feed by raw string (`useAnalyticsActive`) and renders the landscape by its
// raw host-widget id (`analytics:engine-landscape`): keep both stable.
export const ANALYTICS_ENGINE_LANDSCAPE_DATA = "analytics_engine_landscape_data"
