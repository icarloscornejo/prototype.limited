import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A whole comment and nothing else, so an html block that merely contains one is kept.
const COMMENT_NODE = /^<!--(?:(?!-->)[\s\S])*-->$/;
const DATE_LINE = /^(.+): \d{4}-\d{2}-\d{2}$/m;
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * The "Last updated" label is copy, so it is read from content/ (the first legal
 * page of the same language that already carries a date line) instead of living in code.
 * @param {string} directory
 * @returns {string}
 */
function findDateLabel(directory) {
  const files = readdirSync(directory).filter((name) => name.endsWith(".md")).sort();
  for (const name of files) {
    const body = readFileSync(join(directory, name), "utf8").replace(FRONT_MATTER, "");
    const match = body.match(DATE_LINE);
    if (match) return match[1];
  }
  throw new Error(`No "Last updated" label found in ${directory}`);
}

/**
 * Satteri mdast plugin factory (runs once per document):
 * 1. Drops HTML comments, which are author notes (PROTO-5, PROTO-6) and must not ship.
 * 2. Renders the front matter date right after the H1 on pages whose body has no date line.
 * @param {{ fileURL?: URL, source: string, data: { astro?: { frontmatter?: Record<string, unknown> } } }} context
 */
export function legalMarkdown(context) {
  const lastUpdated = context.data.astro?.frontmatter?.last_updated;
  const needsDateLine = lastUpdated !== undefined && context.fileURL !== undefined && !DATE_LINE.test(context.source);
  let dateInserted = false;

  return {
    name: "legal-markdown",
    html(node, ctx) {
      if (COMMENT_NODE.test(node.value.trim())) ctx.removeNode(node);
    },
    heading(node, ctx) {
      if (!needsDateLine || dateInserted || node.depth !== 1) return;
      dateInserted = true;
      // Unquoted YAML dates arrive as Date (midnight UTC); a quoted one stays a string.
      const date = lastUpdated instanceof Date ? lastUpdated.toISOString().slice(0, 10) : String(lastUpdated);
      const label = findDateLabel(dirname(fileURLToPath(context.fileURL)));
      ctx.insertAfter(node, { type: "paragraph", children: [{ type: "text", value: `${label}: ${date}` }] });
    },
  };
}
