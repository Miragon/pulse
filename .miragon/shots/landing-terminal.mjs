export default async function showTerminalTab(page, { click, pause }) {
  await click(page.locator("#client-tab-1"))
  await pause(600)
}
