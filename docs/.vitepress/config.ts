// The Pulse docs site, built with the Miragon docs kit (docs/.vitepress/miragon/,
// vendored unchanged from Miragon/corporate-identity, skill docs-site). The kit sets
// everything else: base from DOCS_BASE (the repo name, set in .github/workflows/docs.yml),
// theme, colours light and dark, GitHub anchors, Mermaid, search, the legal row.
import { miragonDocs } from "./miragon/config"

export default miragonDocs({
  repo: "Miragon/pulse",
  // The tab reads "<page> | Miragon" like the other Miragon docs; the product name, Pulse,
  // stands next to the Komet. Miragon AI is the family of all tools, this repo is Pulse, and
  // so are its technical names (#415): the repo Miragon/pulse, the Docker image
  // ghcr.io/miragon/pulse-server, the @miragon/pulse-* packages and the MCP server
  // name "pulse".
  title: "Miragon",
  siteTitle: "Pulse",
  description:
    "Pulse: operate and analyse your Camunda 7, CIB seven and Operaton engines from your AI chat, your terminal and VS Code.",
  productPage: "https://miragon.ai/tools/pulse/",
  footerMessage: "Released under the MIT License.",

  // README.md is the index for reading the pages on GitHub; the site's index is
  // index.md.
  srcExclude: ["README.md"],

  nav: [
    { text: "Overview", link: "/overview" },
    { text: "MCP server", link: "/mcp/" },
    { text: "CLI", link: "/cli/" },
    { text: "VS Code", link: "/vscode/" },
  ],

  // One sidebar for the whole site, one group per client.
  sidebar: [
    {
      text: "Pulse",
      items: [{ text: "Overview", link: "/overview" }],
    },
    {
      text: "MCP server",
      collapsed: false,
      items: [
        { text: "Introduction", link: "/mcp/" },
        { text: "Getting started", link: "/mcp/getting-started" },
        { text: "Usage", link: "/mcp/usage" },
        { text: "Tools and settings", link: "/mcp/reference" },
        { text: "Operations", link: "/mcp/operations" },
        { text: "Architecture", link: "/mcp/architecture" },
        { text: "Developer guide", link: "/mcp/developer" },
      ],
    },
    {
      text: "CLI",
      collapsed: false,
      items: [
        { text: "Introduction", link: "/cli/" },
        { text: "Getting started", link: "/cli/getting-started" },
        { text: "Installation", link: "/cli/installation" },
        { text: "Workflow commands", link: "/cli/workflow-commands" },
        { text: "Command structure", link: "/cli/commands" },
        { text: "Recipes", link: "/cli/recipes" },
        { text: "Output and errors", link: "/cli/output-and-errors" },
        { text: "Safety", link: "/cli/safety" },
        { text: "Configuration", link: "/cli/configuration" },
        { text: "Authentication", link: "/cli/authentication" },
        { text: "Engines", link: "/cli/engines" },
        { text: "Using the CLI from AI agents", link: "/cli/agents" },
        {
          text: "Contributing",
          collapsed: true,
          items: [
            { text: "Development", link: "/cli/development" },
            { text: "Releasing", link: "/cli/releasing" },
            { text: "Architecture", link: "/cli/architecture" },
            { text: "Architecture decisions", link: "/cli/adr/" },
          ],
        },
      ],
    },
    {
      text: "VS Code",
      collapsed: false,
      items: [
        { text: "Introduction", link: "/vscode/" },
        { text: "Installation", link: "/vscode/installation" },
        {
          text: "Marketplace",
          link: "https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit",
        },
        { text: "Configuration", link: "/vscode/configuration" },
        { text: "Usage", link: "/vscode/usage" },
        { text: "Boards", link: "/vscode/boards" },
        { text: "Architecture", link: "/vscode/architecture" },
      ],
    },
  ],
})
