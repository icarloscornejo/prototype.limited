import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// content/ is the source of truth for copy: the build only reads it, never rewrites it.
// last_updated is an unquoted YAML date on the legal pages, which parses as a Date.
const pageSchema = z.object({
  page: z.string(),
  path: z.string(),
  title: z.string(),
  description: z.string(),
  last_updated: z.coerce.date().optional(),
  // Short labels of the home sections that the page bodies do not contain (home.md only).
  experience_headline: z.string().optional(),
  experience_caption: z.string().optional(),
  experience_companies: z.string().optional(),
  services_included: z.string().optional(),
  linkedin_label: z.string().optional(),
});

export const collections = {
  en: defineCollection({ loader: glob({ pattern: "*.md", base: "./content/en" }), schema: pageSchema }),
  es: defineCollection({ loader: glob({ pattern: "*.md", base: "./content/es" }), schema: pageSchema }),
};
