import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import { legalMarkdown } from "./src/lib/legal-markdown.mjs";

export default defineConfig({
  output: "static",
  // Preview builds point hreflang and og:url at production until the domain is live.
  site: "https://prototype.limited",
  build: { inlineStylesheets: "always" },
  markdown: {
    processor: satteri({
      // Curly quotes would alter the copy word for word.
      features: { smartPunctuation: false },
      mdastPlugins: [legalMarkdown],
    }),
  },
});
