import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Node does not promise to run the files in the order they are listed, so this file builds dist/ itself.
before(() => {
  const build = spawnSync("pnpm", ["exec", "astro", "build"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
});
const LANGUAGES = ["en", "es"];
const LEGAL_PAGES = ["privacy", "terms", "data-deletion"];
const SECTION_IDS = ["about", "services", "contact"];
const HOME_PATH = { en: "/", es: "/es/" };

const NEW_STRINGS = {
  en: {
    experience_headline: "Over a decade",
    experience_caption: "Founder's experience shipping apps",
    experience_companies: "Founder's professional experience",
    services_included: "What's included",
    linkedin_label: "LinkedIn ↗",
  },
  es: {
    experience_headline: "Más de una década",
    experience_caption: "Experiencia del fundador lanzando apps",
    experience_companies: "Experiencia profesional del fundador",
    services_included: "Qué incluye",
    linkedin_label: "LinkedIn ↗",
  },
};

const FOUNDER_SENTENCE = {
  en: "Founded by an engineer with over a decade shipping apps for global companies.",
  es: "Fundada por un ingeniero con más de una década construyendo apps para empresas globales.",
};

const COMPANIES = ["Disney+", "Nike", "Sephora", "Ticketmaster", "Indeed", "Numerator"];

const readText = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

function filesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const fullPath = join(directory, name);
    return statSync(fullPath).isDirectory() ? filesIn(fullPath) : [fullPath];
  });
}

function loadContent(language, page) {
  const raw = readText(`content/${language}/${page}.md`);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  assert.ok(match, `front matter missing in content/${language}/${page}.md`);
  const data = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separatorIndex = line.indexOf(":");
      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
    }),
  );
  return { data, body: match[2] };
}

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

const BLOCK_TAGS = "p|h[1-6]|li|ul|ol|br|div|section|article|blockquote|hr|pre|table|tr|td|th|details|summary";

// Block tags become a space, inline tags vanish, so adjacent blocks read as one run of text.
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(new RegExp(`</?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const regionOf = (html, tagName) => html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"))?.[1] ?? "";
const homeHtml = (language) => readText(language === "en" ? "dist/index.html" : "dist/es/index.html");
const stripScripts = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, "");

function attributesOf(openingTag) {
  return Object.fromEntries(
    [...openingTag.matchAll(/([a-zA-Z:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((match) => [
      match[1].toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    ]),
  );
}

const tagsNamed = (html, tagName) => [...html.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, "gi"))].map((match) => attributesOf(match[1]));
const inlineStyles = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");

function stripMarkdown(line) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

const bodyLines = (body) => body.split("\n").map((line) => line.trim()).filter(Boolean);
const FOUNDER_LINE = /^(Founded by|Fundada por) /;

// Every line of the four source files that the home renders as visible text.
function expectedHomeLines(language) {
  const home = bodyLines(loadContent(language, "home").body).filter((line) => !FOUNDER_LINE.test(line));
  const services = bodyLines(loadContent(language, "services").body).slice(1);
  const about = bodyLines(loadContent(language, "about").body).slice(1);
  const contact = bodyLines(loadContent(language, "contact").body);
  const withoutTrailingLink = (lines) => (/^\[.+\]\(.+\)$/.test(lines.at(-1)) ? lines.slice(0, -1) : lines);
  const contactLines = contact.map((line) => {
    const value = stripMarkdown(line).replace(/^[^:]+: /, "");
    return /^https?:/.test(value) ? null : value;
  });
  return [...home, ...withoutTrailingLink(services), ...withoutTrailingLink(about), ...contactLines.filter(Boolean)].map(stripMarkdown);
}

const builtHtmlFiles = () => filesIn("dist").filter((file) => file.endsWith(".html"));

describe("home page content", () => {
  for (const language of LANGUAGES) {
    test(`given content/${language}/home.md when read then it carries the five new strings exactly`, () => {
      const { data } = loadContent(language, "home");
      for (const [key, value] of Object.entries(NEW_STRINGS[language])) {
        assert.equal(data[key], value, `${key} in ${language}`);
      }
    });

    test(`given content/${language} when read then home.md and about.md carry the general founder sentence`, () => {
      assert.ok(loadContent(language, "home").body.includes(FOUNDER_SENTENCE[language]), "home.md");
      assert.ok(loadContent(language, "about").body.includes(FOUNDER_SENTENCE[language]), "about.md");
    });

    test(`given the ${language} home when built then the five sections come in the design order with their ids`, () => {
      const html = homeHtml(language);
      const markers = ['class="hero', 'id="about"', 'id="services"', 'id="work"', 'id="contact"'].map((marker) => html.indexOf(marker));
      assert.ok(markers.every((position) => position > -1), `a section is missing: ${markers}`);
      assert.deepEqual([...markers].sort((a, b) => a - b), markers, "sections out of order");
      assert.match(html, /id="home"[^>]*class="home-page"|class="home-page"[^>]*id="home"/);
    });

    test(`given the ${language} home when built then every content line shows, once for the founder sentence`, () => {
      const text = htmlToText(regionOf(homeHtml(language), "main"));
      for (const line of expectedHomeLines(language)) {
        assert.ok(text.includes(line), `missing text: ${line}`);
      }
      assert.equal(text.split(FOUNDER_SENTENCE[language]).length - 1, 1, "founder sentence must show exactly once");
    });

    test(`given the ${language} home when built then nothing shows besides content/, the new strings and the numerals`, () => {
      let text = htmlToText(regionOf(homeHtml(language), "main"));
      const allowed = [...expectedHomeLines(language), ...Object.values(NEW_STRINGS[language]), FOUNDER_SENTENCE[language], "01", "02", "03"];
      for (const piece of allowed.sort((a, b) => b.length - a.length)) text = text.split(piece).join(" ");
      assert.equal(text.replace(/\s+/g, ""), "", `unexpected text left: ${text}`);
    });

    test(`given the ${language} home when built then the contact links are the company email and LinkedIn with the new label`, () => {
      const main = regionOf(homeHtml(language), "main");
      assert.match(main, /<a\b[^>]*href="mailto:hello@prototype\.limited"[^>]*>hello@prototype\.limited<\/a>/);
      assert.match(main, new RegExp(`<a\\b[^>]*href="https://www\\.linkedin\\.com/company/prototype-sv"[^>]*>${NEW_STRINGS[language].linkedin_label}</a>`));
    });

    test(`given the ${language} home when built then the header nav points at the home sections that exist`, () => {
      const html = homeHtml(language);
      const nav = regionOf(regionOf(html, "header"), "nav");
      const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(hrefs, SECTION_IDS.map((id) => `${HOME_PATH[language]}#${id}`));
      for (const id of SECTION_IDS) assert.ok(html.includes(`id="${id}"`), `#${id} missing`);
    });

    test(`given the ${language} home when scripts are removed then every content line is still in the page and every link resolves`, () => {
      const html = homeHtml(language);
      assert.doesNotMatch(regionOf(html, "main"), /<script/i, "content must not depend on scripts");
      const text = htmlToText(regionOf(stripScripts(html), "main"));
      for (const line of expectedHomeLines(language)) assert.ok(text.includes(line), `missing without scripts: ${line}`);
      for (const { href } of tagsNamed(stripScripts(html), "a")) {
        if (!href || /^(mailto:|https?:)/.test(href)) continue;
        const [path, fragment] = href.split("#");
        if (path) assert.ok(existsSync(join("dist", path, path.endsWith(".html") ? "" : "index.html")), `${href} has no page`);
        const target = path ? readText(join("dist", path, "index.html")) : html;
        if (fragment) assert.ok(target.includes(`id="${fragment}"`), `${href} has no target`);
      }
    });
  }
});

describe("page chrome", () => {
  const builtPages = [
    "dist/index.html",
    "dist/es/index.html",
    ...LANGUAGES.flatMap((language) => LEGAL_PAGES.map((page) => (language === "en" ? `dist/${page}/index.html` : `dist/es/${page}/index.html`))),
  ];

  for (const file of builtPages) {
    test(`given ${file} when built then it starts with a skip link to main, has the inline mark and a color-scheme meta`, () => {
      const html = readText(file);
      assert.ok(html, `${file} missing`);
      const body = html.match(/<body\b[^>]*>([\s\S]*)/i)?.[1] ?? "";
      assert.match(body.trimStart(), /^<a\b[^>]*class="skip-link"[^>]*href="#main"|^<a\b[^>]*href="#main"[^>]*class="skip-link"/);
      assert.match(html, /<main\b[^>]*id="main"/);
      const header = regionOf(html, "header");
      assert.match(header, /<svg\b[^>]*viewBox="0 0 260 120"[^>]*aria-hidden="true"|<svg\b[^>]*aria-hidden="true"[^>]*viewBox="0 0 260 120"/);
      assert.doesNotMatch(header, /<svg\b[^>]*>\s*<title/i);
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1, "exactly one h1 per page");
      assert.ok(tagsNamed(html, "meta").some((meta) => meta.name === "color-scheme" && meta.content === "light dark"));
    });
  }

  for (const language of LANGUAGES) {
    for (const page of LEGAL_PAGES) {
      test(`given ${language}/${page} when built then it uses the narrow legal template`, () => {
        const html = readText(language === "en" ? `dist/${page}/index.html` : `dist/es/${page}/index.html`);
        assert.match(html, /class="[^"]*\blegal-page\b/);
        assert.ok(regionOf(html, "header") && regionOf(html, "footer"));
      });
    }
  }

  test("given the home when built then the mark is in the header and in the hero Paper lines panel, and nowhere else", () => {
    for (const language of LANGUAGES) {
      const html = homeHtml(language);
      assert.equal((html.match(/viewBox="0 0 260 120"/g) ?? []).length, 2, "the mark appears in the header and in the hero panel");
      assert.doesNotMatch(html, /logo.?stud|variant-rings|variant-inset/i);
      const hero = html.match(/<section\b[^>]*class="hero[\s\S]*?<\/section>/)?.[0] ?? "";
      assert.match(hero, /class="[^"]*\bhero-art\b[^"]*"[^>]*aria-hidden="true"[^>]*>\s*<div class="hero-frame">\s*<svg\b[^>]*viewBox="0 0 260 120"/);
      assert.doesNotMatch(hero, /<img/i);
      assert.equal((hero.match(/<a\b/g) ?? []).length, 2, "two buttons");
    }
  });

  test("given the built home when its inline CSS is read then the Paper lines panel keeps the design's numbers", () => {
    const css = inlineStyles(homeHtml("en")).replace(/\s+/g, "");
    assert.match(css, /\.hero-frame\{[^}]*min-height:128px/);
    assert.match(css, /\.hero-frame:before\{[^}]*inset:18px24px/);
    assert.match(css, /\.hero-frame:before\{[^}]*border-block:1pxsolid/);
    assert.match(css, /\.hero-framesvg\{[^}]*width:min\(34%,180px\)/);
    for (const stop of ["12%", "12.5%", "87.5%", "88%"]) assert.ok(css.includes(stop), `gradient stop ${stop} missing`);
  });

  test("given every built page when read then no raster mark, data URI or blend mode ships", () => {
    for (const file of builtHtmlFiles()) {
      const html = readText(file);
      assert.doesNotMatch(html, /data:image/i, file);
      assert.doesNotMatch(inlineStyles(html), /mix-blend-mode|\.original-mark/, file);
      assert.doesNotMatch(html, /<img\b[^>]*(mark|logo-prototype)/i, file);
    }
  });
});

describe("redirects", () => {
  const RULES = {
    "/services": "/#services",
    "/about": "/#about",
    "/contact": "/#contact",
    "/es/services": "/es/#services",
    "/es/about": "/es/#about",
    "/es/contact": "/es/#contact",
  };

  test("given dist/_redirects when read then every old URL maps with a 301 to its home section, with and without the trailing slash", () => {
    const rules = readText("dist/_redirects")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/));
    for (const [source, destination] of Object.entries(RULES)) {
      for (const from of [source, `${source}/`]) {
        const rule = rules.find((parts) => parts[0] === from);
        assert.ok(rule, `no rule for ${from}`);
        assert.deepEqual(rule.slice(1), [destination, "301"], from);
      }
    }
    assert.equal(rules.length, 12);
  });

  test("given the redirect destinations when checked against the built home then each fragment is a real section id", () => {
    for (const destination of Object.values(RULES)) {
      const [path, fragment] = destination.split("#");
      const html = readText(path === "/" ? "dist/index.html" : "dist/es/index.html");
      assert.ok(html.includes(`id="${fragment}"`), destination);
    }
  });

  test("given the build when finished then no page exists at the redirected paths", () => {
    for (const source of Object.keys(RULES)) {
      assert.ok(!existsSync(join("dist", source, "index.html")), `${source} must not be built`);
    }
  });
});

describe("styles", () => {
  test("given the built home when its inline CSS is read then it has the palettes, the scroll animations and the reduced motion rules", () => {
    const css = inlineStyles(homeHtml("en"));
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /@supports\s*\(\s*animation-timeline:\s*view\(\)\s*\)/);
    assert.match(css, /prefers-reduced-motion:\s*no-preference/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /animation:\s*none\s*!important/);
    for (const selector of [".home-page .hero h1", ".home-page .services h2", ".home-page .background h2"]) {
      assert.ok(css.includes(selector), `selector missing: ${selector}`);
    }
  });

  test("given the built home when its inline CSS is read then the logos turn dark in light mode and light in dark mode", () => {
    const css = inlineStyles(homeHtml("en"));
    assert.match(css, /brightness\(0\)/);
    // The minifier writes invert(1) as invert().
    assert.match(css, /invert\(\s*(1|100%)?\s*\)/);
  });
});

describe("company logos", () => {
  for (const language of LANGUAGES) {
    test(`given the ${language} home when built then the six logos are self-hosted svg files with the company name as alt`, () => {
      const about = homeHtml(language).match(/id="about"[\s\S]*?id="services"/)?.[0] ?? "";
      const images = tagsNamed(about, "img");
      assert.deepEqual(images.map((image) => image.alt), COMPANIES);
      for (const image of images) {
        assert.match(image.src, /^\/logos\/[a-z-]+\.svg$/);
        const svg = readText(`dist${image.src}`);
        assert.match(svg, /<svg\b/);
        assert.match(svg, /viewBox=/);
        assert.doesNotMatch(svg, /<script|<image\b|<foreignObject|(?:xlink:)?href=["']https?:/i);
        assert.doesNotMatch(svg, /<!--|<metadata/);
      }
    });
  }

  test("given the logo files when read then none paints a full-canvas white background", () => {
    for (const file of filesIn("public/logos")) {
      assert.doesNotMatch(readText(file), /fill="#(?:fff|ffffff)"[^>]*d="M0 0h/i, file);
    }
  });
});

describe("scripts and requests", () => {
  const FORBIDDEN_APIS = /document\.cookie|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage/;

  test("given every built page when read then each script is an own module (same-origin src or inline), never external", () => {
    for (const file of builtHtmlFiles()) {
      const html = readText(file);
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      assert.ok(scripts.length > 0, `${file} has no enhancement script`);
      for (const [, attributes, inline] of scripts) {
        const { src, type } = attributesOf(attributes);
        assert.equal(type, "module", `${file} script type`);
        if (src) assert.match(src, /^\/(?!\/)/, `${file} external script ${src}`);
        else assert.doesNotMatch(inline, FORBIDDEN_APIS, file);
      }
    }
  });

  test("given the emitted JavaScript files when read then none touches cookies, storage or the network", () => {
    for (const file of filesIn("dist").filter((name) => name.endsWith(".js"))) {
      assert.doesNotMatch(readText(file), FORBIDDEN_APIS, file);
    }
  });

  test("given the README when read then it states the JavaScript rule as an enhancement only", () => {
    const readme = readText("README.md");
    assert.match(readme, /progressive enhancement/i);
    assert.doesNotMatch(readme, /no client JavaScript/i);
  });

  test("given every built page when read then no resource loads from another host", () => {
    const own = /^https:\/\/prototype\.limited(\/|$)/;
    for (const file of builtHtmlFiles()) {
      const html = readText(file);
      const references = [
        ...tagsNamed(html, "script").map((tag) => tag.src),
        ...tagsNamed(html, "img").map((tag) => tag.src),
        ...tagsNamed(html, "source").map((tag) => tag.src),
        ...tagsNamed(html, "iframe").map((tag) => tag.src),
        ...tagsNamed(html, "link").filter((tag) => tag.rel !== "alternate").map((tag) => tag.href),
      ].filter(Boolean);
      for (const reference of references) assert.ok(!/^(https?:)?\/\//.test(reference) || own.test(reference), `${file}: ${reference}`);
      for (const [, url] of inlineStyles(html).matchAll(/url\(\s*["']?([^"')]+)/g)) {
        assert.doesNotMatch(url, /^(https?:)?\/\//, `${file}: css url ${url}`);
      }
      assert.doesNotMatch(inlineStyles(html), /@import/, file);
    }
  });

  test("given the built site when read then no font file ships and the type is the system font stack", () => {
    assert.deepEqual(filesIn("dist").filter((file) => /\.(woff2?|ttf|otf)$/i.test(file)), []);
    for (const file of builtHtmlFiles()) {
      const html = readText(file);
      assert.doesNotMatch(inlineStyles(html), /@font-face/, file);
      assert.ok(!tagsNamed(html, "link").some((tag) => tag.as === "font"), `${file} preloads a font`);
    }
    const css = inlineStyles(homeHtml("en"));
    assert.match(css, /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"?SF Pro Text"?,\s*"?SF Pro Display"?,\s*system-ui,\s*"?Segoe UI"?,\s*Roboto,\s*"?Helvetica Neue"?,\s*Arial,\s*sans-serif/);
  });

  test("given package.json and the lockfile when read then the font dependency is gone", () => {
    assert.doesNotMatch(readText("package.json"), /fontsource/);
    assert.doesNotMatch(readText("pnpm-lock.yaml"), /fontsource/);
  });
});
