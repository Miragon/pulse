export default async function showVsCodeTab(page, { click, pause }) {
  await click(page.locator("#client-tab-2"))
  await pause(600)
}
