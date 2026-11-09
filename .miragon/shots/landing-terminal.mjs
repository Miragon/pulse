export default async function showTerminalTab(page, { click, pause }) {
  await click(page.locator("#client-tab-1"))
  await page.addStyleTag({ content: ".term-bar { display: none }" })
  await pause(600)
}
