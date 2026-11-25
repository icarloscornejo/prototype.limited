import type { PageEntry } from "./site";

export type Service = { title: string; description: string; fit: string; duration: string; deliverables: string[] };
export type Principle = { lead: string; rest: string };

export type HomeCopy = {
  hero: { firstLine: string; secondLine: string; intro: string; primaryAction: string; secondaryAction: string };
  about: {
    heading: string;
    lead: string;
    context: string[];
    beliefsTitle: string;
    beliefs: string[];
    headline: string;
    caption: string;
    companiesLabel: string;
  };
  services: { heading: string; intro: string; included: string; items: Service[] };
  work: { heading: string; principles: Principle[] };
  contact: { heading: string; intro: string; email: string; linkedinLabel: string; linkedinUrl: string };
};

type Block = { title: string; lines: string[] };

const LINK_LINE = /^\[(.+)\]\(.+\)$/;

// The content files are the source of the copy, so a shape the parser does not expect must stop the build.
function fail(entry: PageEntry, problem: string): never {
  throw new Error(`content/${entry.id}.md: ${problem}`);
}

const bodyLines = (entry: PageEntry): string[] =>
  (entry.body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("<!--"));

// Splits the lines at every heading of the given depth. The lines before the first heading go in a block with an empty title.
function blocksOf(lines: string[], marker: string): Block[] {
  const blocks: Block[] = [{ title: "", lines: [] }];
  for (const line of lines) {
    if (line.startsWith(`${marker} `)) blocks.push({ title: line.slice(marker.length + 1), lines: [] });
    else blocks.at(-1)!.lines.push(line);
  }
  return blocks;
}

const bulletText = (line: string): string => line.replace(/^- /, "");

function splitAt(text: string, separator: string, fromEnd: boolean, entry: PageEntry): [string, string] {
  const position = fromEnd ? text.lastIndexOf(separator) : text.indexOf(separator);
  if (position < 0) fail(entry, `expected "${separator}" in: ${text}`);
  return [text.slice(0, position + 1), text.slice(position + separator.length)];
}

function parseHero(home: PageEntry): { headingLine: string; intro: string; primary: string; sections: Block[] } {
  const [opening, ...sections] = blocksOf(bodyLines(home), "##");
  const [heading, intro, primaryLink] = opening.lines;
  const primary = primaryLink?.match(LINK_LINE)?.[1];
  if (!heading?.startsWith("# ") || !intro || !primary) fail(home, "expected a title, an intro and a link before the first section");
  return { headingLine: heading.slice(2), intro, primary, sections };
}

function parseServicesFile(services: PageEntry): { intro: string; items: Block[] } {
  const [opening, ...items] = blocksOf(bodyLines(services), "##");
  const intro = opening.lines[1];
  if (!intro) fail(services, "expected an intro paragraph after the title");
  return { intro, items };
}

export function parseHomeCopy(entries: { home: PageEntry; services: PageEntry; about: PageEntry; contact: PageEntry }): HomeCopy {
  const { home, services, about, contact } = entries;
  const labels = home.data;
  if (!labels.experience_headline || !labels.experience_caption || !labels.experience_companies || !labels.services_included || !labels.linkedin_label) {
    fail(home, "the five home labels are missing from the front matter");
  }

  const { headingLine, intro, primary, sections } = parseHero(home);
  if (sections.length !== 3) fail(home, `expected 3 sections after the title, found ${sections.length}`);
  const [offering, how, background] = sections;
  const [firstLine, secondLine] = splitAt(headingLine, ", ", false, home);
  const secondaryAction = offering.lines.at(-1)?.match(LINK_LINE)?.[1];
  if (!secondaryAction) fail(home, "expected a link at the end of the first section");

  const homeServices = blocksOf(offering.lines.slice(0, -1), "###").slice(1);
  const { intro: servicesIntro, items } = parseServicesFile(services);
  if (homeServices.length !== 3 || items.length !== 3) fail(services, "expected 3 services in home.md and in services.md");

  const aboutBlocks = blocksOf(bodyLines(about), "##");
  const [aboutOpening, beliefs] = aboutBlocks;
  const [, aboutFirst, aboutSecond, aboutFounder] = aboutOpening.lines;
  if (!aboutFirst || !aboutSecond || !aboutFounder || !beliefs) fail(about, "expected three paragraphs and a beliefs section");
  const [lead, context] = splitAt(aboutFirst, ". ", false, about);

  const contactLines = bodyLines(contact);
  const contactItems = contactLines.filter((line) => line.startsWith("- ")).map(bulletText);
  const valueOf = (item: string | undefined): string => item?.slice(item.indexOf(": ") + 2) ?? "";
  const email = valueOf(contactItems.find((item) => item.includes("@")));
  const linkedinUrl = valueOf(contactItems.find((item) => item.includes("http")));
  if (!contactLines[0]?.startsWith("# ") || !contactLines[1] || !email || !linkedinUrl) fail(contact, "expected a title, an intro, an email and a LinkedIn URL");

  return {
    hero: { firstLine, secondLine, intro, primaryAction: primary, secondaryAction },
    about: {
      heading: background.title,
      lead,
      context: [context, aboutSecond, aboutFounder],
      beliefsTitle: beliefs.title,
      beliefs: beliefs.lines.filter((line) => line.startsWith("- ")).map(bulletText),
      headline: labels.experience_headline,
      caption: labels.experience_caption,
      companiesLabel: labels.experience_companies,
    },
    services: {
      heading: offering.title,
      intro: servicesIntro,
      included: labels.services_included,
      items: homeServices.map((block, index) => {
        const [meta, ...bullets] = items[index].lines;
        if (!block.lines[0] || !meta) fail(services, `service ${index + 1} needs a description in home.md and a fit line in services.md`);
        const [fit, duration] = splitAt(meta, ". ", true, services);
        return { title: block.title, description: block.lines[0], fit, duration, deliverables: bullets.filter((line) => line.startsWith("- ")).map(bulletText) };
      }),
    },
    work: {
      heading: how.title,
      principles: how.lines.map((line) => {
        const match = bulletText(line).match(/^\*\*(.+?)\*\* (.*)$/);
        if (!match) fail(home, `expected "**lead** rest" in: ${line}`);
        return { lead: match[1], rest: match[2] };
      }),
    },
    contact: { heading: contactLines[0].slice(2), intro: contactLines[1], email, linkedinLabel: labels.linkedin_label, linkedinUrl },
  };
}
