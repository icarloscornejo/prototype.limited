import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SITE_ORIGIN = "https://prototype.limited";
const LANGUAGES = ["en", "es"];
const MAIN_PAGES = ["home", "services", "about", "contact"];
const LEGAL_PAGES = ["privacy", "terms", "data-deletion"];
const SWITCH_LABELS = { en: "EN", es: "ES" };
const TITLE_SUFFIX = / \| Prototype$/;

// Build once and capture the result instead of throwing, so each test fails on
// its own when the pages do not exist yet.
let buildResult;
before(() => {
  buildResult = spawnSync("pnpm", ["build"], { encoding: "utf8" });
});

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// Tiny front matter reader: the content files only use flat `key: value` lines.
function loadEntry(language, page) {
  const raw = readText(`content/${language}/${page}.md`);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  assert.ok(match, `front matter missing in content/${language}/${page}.md`);
  const data = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separatorIndex = line.indexOf(":");
      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
    }),
  );
  return { language, page, ...data, body: match[2] };
}

const entries = Object.fromEntries(
  LANGUAGES.flatMap((language) =>
    [...MAIN_PAGES, ...LEGAL_PAGES].map((page) => [`${language}/${page}`, loadEntry(language, page)]),
  ),
);
const mainEntries = LANGUAGES.flatMap((language) => MAIN_PAGES.map((page) => entries[`${language}/${page}`]));

const labelFromTitle = (entry) => entry.title.replace(TITLE_SUFFIX, "");

// "/" builds to dist/index.html, every other route to dist/<slug>/index.html.
function distFileForPath(routePath) {
  const slug = routePath.replace(/^\/|\/$/g, "");
  return slug ? `dist/${slug}/index.html` : "dist/index.html";
}

const readPageHtml = (entry) => readText(distFileForPath(entry.path));
const counterpartOf = (entry) => entries[`${entry.language === "en" ? "es" : "en"}/${entry.page}`];
const absoluteUrl = (routePath) => new URL(routePath, SITE_ORIGIN).href;

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const BLOCK_TAGS = "p|h[1-6]|li|ul|ol|br|div|section|article|blockquote|hr|pre|table|tr|td|th";

// Block tags become a space so words never glue together; inline tags vanish so
// punctuation after a link stays attached. Comments are dropped first.
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(new RegExp(`</?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function markdownToText(markdown) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function regionOf(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? match[1] : "";
}

function attributesOf(openingTag) {
  return Object.fromEntries(
    [...openingTag.matchAll(/([a-zA-Z:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((match) => [
      match[1].toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    ]),
  );
}

function anchorsIn(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attributes: attributesOf(match[1]),
    text: htmlToText(match[2]),
  }));
}

function tagsNamed(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, "gi"))].map((match) => attributesOf(match[1]));
}

const metaContent = (html, attributeName, attributeValue) =>
  tagsNamed(html, "meta").find((attributes) => attributes[attributeName] === attributeValue)?.content;

const inlineStyles = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");

describe("pages build", () => {
  test("given the repo when pnpm build runs then it succeeds", () => {
    assert.equal(buildResult.status, 0, buildResult.stderr);
  });
});

describe("routes render content word for word", () => {
  for (const entry of mainEntries) {
    test(`given ${entry.language}/${entry.page} when built then ${entry.path} renders its markdown body word for word`, () => {
      const file = distFileForPath(entry.path);
      assert.ok(existsSync(file), `${file} missing`);
      assert.equal(htmlToText(regionOf(readText(file), "main")), markdownToText(entry.body));
    });
  }
});

describe("content links work as written", () => {
  for (const entry of mainEntries) {
    const internalLinks = [...entry.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) => match[1]);
    for (const target of internalLinks) {
      test(`given ${entry.language}/${entry.page} when it links ${target} then the link is unchanged and the target exists`, () => {
        const mainAnchors = anchorsIn(regionOf(readPageHtml(entry), "main"));
        assert.ok(mainAnchors.some((anchor) => anchor.attributes.href === target), `href="${target}" missing in main`);
        assert.ok(existsSync(distFileForPath(target)), `${distFileForPath(target)} missing`);
        assert.ok(target.startsWith(entry.language === "es" ? "/es/" : "/"), "link must stay in the same language");
      });
    }
  }
});

describe("language switch is a plain link", () => {
  for (const entry of mainEntries) {
    test(`given ${entry.language}/${entry.page} when rendered then the other language is a plain link and the current one is not`, () => {
      const html = readPageHtml(entry);
      const counterpart = counterpartOf(entry);
      const currentLabel = SWITCH_LABELS[entry.language];
      const otherLabel = SWITCH_LABELS[counterpart.language];
      const otherAnchor = anchorsIn(html).find((anchor) => anchor.text === otherLabel);
      assert.ok(otherAnchor, `link ${otherLabel} missing`);
      assert.equal(otherAnchor.attributes.href, counterpart.path);
      assert.equal(otherAnchor.attributes.hreflang, counterpart.language);
      assert.equal(otherAnchor.attributes.lang, counterpart.language);
      assert.ok(!anchorsIn(html).some((anchor) => anchor.text === currentLabel), `${currentLabel} must not be a link`);
      const currentSpan = [...html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].find(
        (match) => htmlToText(match[2]) === currentLabel,
      );
      assert.ok(currentSpan, `span ${currentLabel} missing`);
      assert.equal(attributesOf(currentSpan[1])["aria-current"], "true");
    });
  }
});

describe("header name and nav", () => {
  for (const entry of mainEntries) {
    test(`given ${entry.language}/${entry.page} when rendered then the header has the name and nav in the current language`, () => {
      const anchors = anchorsIn(regionOf(readPageHtml(entry), "header"));
      const languageHome = entries[`${entry.language}/home`];
      const nameAnchor = anchors.find((anchor) => anchor.text === "Prototype");
      assert.ok(nameAnchor, "name link missing");
      assert.equal(nameAnchor.attributes.href, languageHome.path);
      for (const page of ["services", "about", "contact"]) {
        const navEntry = entries[`${entry.language}/${page}`];
        const navAnchor = anchors.find((anchor) => anchor.text === labelFromTitle(navEntry));
        assert.ok(navAnchor, `nav link ${labelFromTitle(navEntry)} missing`);
        assert.equal(navAnchor.attributes.href, navEntry.path);
      }
    });
  }
});

describe("footer legal links", () => {
  for (const entry of mainEntries) {
    test(`given ${entry.language}/${entry.page} when rendered then the footer links the three legal pages`, () => {
      const anchors = anchorsIn(regionOf(readPageHtml(entry), "footer"));
      for (const page of LEGAL_PAGES) {
        const legalEntry = entries[`${entry.language}/${page}`];
        const legalAnchor = anchors.find((anchor) => anchor.text === labelFromTitle(legalEntry));
        assert.ok(legalAnchor, `footer link ${labelFromTitle(legalEntry)} missing`);
        assert.equal(legalAnchor.attributes.href, legalEntry.path);
      }
    });
  }
});

describe("head metadata", () => {
  for (const entry of mainEntries) {
    const label = `${entry.language}/${entry.page}`;

    test(`given ${label} when the head is read then title, description and Open Graph tags match the front matter`, () => {
      const html = readPageHtml(entry);
      assert.ok(html.includes(`<title>${entry.title}</title>`) || htmlToText(regionOf(html, "title")) === entry.title);
      assert.equal(metaContent(html, "name", "description"), entry.description);
      assert.equal(metaContent(html, "property", "og:title"), entry.title);
      assert.equal(metaContent(html, "property", "og:description"), entry.description);
      assert.equal(metaContent(html, "property", "og:type"), "website");
      assert.equal(metaContent(html, "property", "og:url"), absoluteUrl(entry.path));
      for (const property of ["og:site_name", "og:locale"]) {
        assert.ok(metaContent(html, "property", property), `${property} missing`);
      }
    });

    test(`given ${label} when the head is read then html lang is ${entry.language}`, () => {
      const htmlTag = readPageHtml(entry).match(/<html\b([^>]*)>/i);
      assert.ok(htmlTag, "html tag missing");
      assert.equal(attributesOf(htmlTag[1]).lang, entry.language);
    });

    test(`given ${label} when the head is read then hreflang alternates are absolute and consistent with og:url`, () => {
      const html = readPageHtml(entry);
      const alternates = tagsNamed(html, "link").filter((attributes) => attributes.rel === "alternate" && attributes.hreflang);
      const hrefByLanguage = Object.fromEntries(alternates.map((attributes) => [attributes.hreflang, attributes.href]));
      const englishEntry = entries[`en/${entry.page}`];
      assert.equal(hrefByLanguage.en, absoluteUrl(englishEntry.path));
      assert.equal(hrefByLanguage.es, absoluteUrl(entries[`es/${entry.page}`].path));
      assert.equal(hrefByLanguage["x-default"], absoluteUrl(englishEntry.path));
      assert.equal(hrefByLanguage[entry.language], metaContent(html, "property", "og:url"));
    });

    test(`given ${label} when the head is read then a favicon is declared, the viewport is set and nothing heavy ships`, () => {
      const html = readPageHtml(entry);
      const iconLink = tagsNamed(html, "link").find((attributes) => attributes.rel === "icon");
      assert.ok(iconLink, "icon link missing");
      assert.ok(existsSync(`dist${new URL(iconLink.href, SITE_ORIGIN).pathname}`), `${iconLink.href} missing in dist`);
      assert.match(metaContent(html, "name", "viewport") ?? "", /width=device-width/);
      assert.doesNotMatch(html, /<img\b/i);
      assert.doesNotMatch(html, /@font-face|\.(woff2?|ttf|otf)\b/i);
      assert.doesNotMatch(html, /<script\b/i);
    });

    test(`given ${label} when the inline CSS is read then it follows the color scheme and wraps long words`, () => {
      const css = inlineStyles(readPageHtml(entry));
      assert.match(css, /prefers-color-scheme:\s*dark/);
      assert.match(css, /overflow-wrap:\s*anywhere/);
    });
  }
});
