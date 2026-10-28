/** Constants so a tool rename trips a TS error at every call site. */
export const ANALYTICS_DASHBOARD_DATA = "analytics_dashboard_data"
export const ANALYTICS_FAILURE_DASHBOARD_DATA = "analytics_failure_dashboard_data"
// camunda7's process-incidents flow references this by raw string: keep it stable.
export const ANALYTICS_BPMN_HEATMAP_DATA = "analytics_bpmn_heatmap_data"
// Kept out of the heat payload, so the model never reads the XML.
export const ANALYTICS_BPMN_XML_DATA = "analytics_bpmn_xml_data"
// camunda7's cockpit references the landscape by widget id (tier-2).
export const ANALYTICS_ENGINE_LANDSCAPE_DATA = "analytics_engine_landscape_data"
export const ANALYTICS_SETTINGS_DATA = "analytics_settings_data"
export const ANALYTICS_SAVE_SETTINGS = "analytics_save_settings"
