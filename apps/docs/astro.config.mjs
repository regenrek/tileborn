import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  outDir: "dist",
  integrations: [
    starlight({
      title: "Tileborne",
      description: "Open-source tilemap editor and multiplayer game runtime platform.",
      social: [],
      editLink: {
        baseUrl: "https://github.com/tileborne/tileborne/edit/main/",
      },
      sidebar: [
        { label: "Introduction", slug: "index" },
        { label: "Getting Started", slug: "getting-started" },
        { label: "Architecture", slug: "architecture" },
        {
          label: "Guides",
          items: [
            { label: "Editor UX", slug: "editor-ux" },
            { label: "Runtime & Game Host", slug: "runtime" },
            { label: "Runtime SDK", slug: "runtime/sdk" },
            { label: "Gameplay Behaviors", slug: "gameplay-behaviors" },
            { label: "Battle Royale Creator Guide", slug: "battle-royale/creator-guide" },
            { label: "Plugins", slug: "plugins" },
            { label: "Plugin SDK", slug: "plugins/sdk" },
            { label: "Asset Pipeline", slug: "asset-pipeline" },
            { label: "Security", slug: "security" },
            { label: "Ship Pipeline", slug: "deploy/ship-pipeline" },
            { label: "Cloudflare Deploy", slug: "deploy/cloudflare" },
            { label: "Release Readiness", slug: "release-readiness" },
          ],
        },
        { label: "CLI Reference", slug: "cli" },
        {
          label: "API Reference",
          collapsed: true,
          items: [{ autogenerate: { directory: "reference" } }],
        },
        {
          label: "Architecture Decisions",
          collapsed: true,
          items: [{ autogenerate: { directory: "adrs" } }],
        },
        { label: "Follow-ups", slug: "follow-ups" },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
