import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  // Preview builds point hreflang and og:url at production until the domain is live.
  site: "https://prototype.limited",
  build: { inlineStylesheets: "always" },
  // Curly quotes would alter the copy word for word.
  markdown: { smartypants: false },
});
