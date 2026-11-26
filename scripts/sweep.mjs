#!/usr/bin/env node
// Responsive sweep: loads every built page at many widths, in both themes, headless, saves a
// screenshot of each and runs the layout checks. It is a review tool, not part of the build or of
// `pnpm test` (it needs a browser and takes minutes).
//
//   pnpm build && pnpm exec astro preview --port 4400 --host 127.0.0.1 &
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/sweep.mjs --out sweep/after > sweep/after/report.json
//   PLAYWRIGHT_MODULE=... node scripts/sweep.mjs --self-test
//
// Playwright is deliberately not a dependency of the site: PLAYWRIGHT_MODULE points at an install
// that already exists on the machine. The exit code is 1 when any issue is found or a cell is missing.
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

const BASE_WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];
// One px each side of every max-width breakpoint in global.css (420, 600, 680, 850, 1100).
const BREAKPOINT_WIDTHS = [419, 421, 599, 601, 679, 681, 849, 851, 1099, 1101];
const WIDTHS = [...BASE_WIDTHS, ...BREAKPOINT_WIDTHS].sort((a, b) => a - b);
const SCHEMES = ["light", "dark"];
const VIEWPORT_HEIGHT = 900;
const MOBILE_MAX_WIDTH = 768;
const MOTION_WIDTHS = [390, 1024, 1280];
const MISSING_ROUTE = "/no-existe";
const MISSING_ROUTE_ES = "/es/no-existe";
// Literal expectations, independent of the hrefs they test: the order of the header links.
const SECTION_HASHES = ["#about", "#services", "#contact"];
const CONCURRENCY = 4;

/**
 * Runs inside the page. Everything it needs is declared in here because Playwright serializes it.
 * `only` limits the run to some check groups; `width` decides whether tap targets apply.
 */
function pageChecks({ width, mobileMax, only }) {
  const issues = [];
  const want = (group) => !only || only.includes(group);
  const describe = (element) => {
    const caseName = element.getAttribute("data-case");
    const classes = typeof element.className === "string" && element.className.trim() ? `.${element.className.trim().split(/\s+/).join(".")}` : "";
    const text = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes}${caseName ? `[case=${caseName}]` : ""} "${text}"`;
  };
  const add = (check, element, detail) => {
    if (issues.filter((issue) => issue.check === check).length < 12) issues.push({ check, where: element ? describe(element) : "page", detail });
  };
  const isShown = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const overlapOf = (first, second) => ({
    x: Math.min(first.right, second.right) - Math.max(first.left, second.left),
    y: Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  });
  const skipLinkHidden = (element) => {
    const skip = element.closest(".skip-link");
    return skip && !skip.matches(":focus");
  };

  if (want("hscroll")) {
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) add("hscroll", null, `scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}`);
  }

  if (want("text")) {
    const items = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, noscript") || skipLinkHidden(parent)) continue;
      // Chromium still lays out the body of a closed <details>, but nobody sees it: the open state gets its own pass.
      if (parent.closest("details:not([open])") && !parent.closest("summary")) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      // A glyph box is taller than a tight line-height; only the line box itself can collide with the next line.
      const rects = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => {
          const height = Math.min(rect.height, lineHeight);
          const top = rect.top + (rect.height - height) / 2;
          return { left: rect.left, right: rect.right, top, bottom: top + height };
        });
      if (rects.length) items.push({ node, parent, rects, inHeader: Boolean(parent.closest(".site-header")) });
    }

    for (const item of items) {
      for (const rect of item.rects) {
        if (rect.left < -1 || rect.right > window.innerWidth + 1) {
          add("text-outside-viewport", item.parent, `x ${Math.round(rect.left)} to ${Math.round(rect.right)} in a ${window.innerWidth}px viewport`);
          break;
        }
      }
      for (let ancestor = item.parent; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clipsX = /hidden|clip|auto|scroll/.test(style.overflowX);
        const clipsY = /hidden|clip|auto|scroll/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const box = ancestor.getBoundingClientRect();
        const cut = item.rects.find((rect) => (clipsX && (rect.left < box.left - 1 || rect.right > box.right + 1)) || (clipsY && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)));
        if (cut) {
          add("text-clipped", item.parent, `cut by ${describe(ancestor)}`);
          break;
        }
      }
    }

    // Every pair of distinct text nodes, page wide: the header grid at <= 680px puts nodes of different parents on one row.
    for (let first = 0; first < items.length; first += 1) {
      for (let second = first + 1; second < items.length; second += 1) {
        const left = items[first];
        const right = items[second];
        // The sticky header is opaque: content that scrolls under it is covered on purpose, not colliding.
        if (left.inHeader !== right.inHeader) continue;
        const collides = left.rects.some((leftRect) =>
          right.rects.some((rightRect) => {
            const { x, y } = overlapOf(leftRect, rightRect);
            return x > 2 && y > 2;
          }),
        );
        if (collides) add("text-overlap", left.parent, `overlaps ${describe(right.parent)}`);
      }
    }
  }

  if (want("tap") && width <= mobileMax) {
    for (const target of document.querySelectorAll("a[href], button, summary, input, select, textarea")) {
      if (!isShown(target) || skipLinkHidden(target)) continue;
      const box = target.getBoundingClientRect();
      const block = target.closest("p, li, dd, td");
      const insideProse = getComputedStyle(target).display === "inline" && block && !target.closest(".action") && block.textContent.replace(target.textContent, "").trim().length > 0;
      if (insideProse) continue; // WCAG 2.5.8: an inline link in a sentence is exempt.
      if (box.width < 43.5 || box.height < 43.5) add("tap-target", target, `${Math.round(box.width)} x ${Math.round(box.height)} px`);
    }
  }

  if (want("images")) {
    for (const image of document.querySelectorAll("img")) {
      if (!isShown(image)) continue;
      const box = image.getBoundingClientRect();
      if (!image.complete || image.naturalWidth === 0) {
        add("image-broken", image, "did not load");
        continue;
      }
      const attributeWidth = Number(image.getAttribute("width"));
      const attributeHeight = Number(image.getAttribute("height"));
      const intrinsic = attributeWidth && attributeHeight ? attributeWidth / attributeHeight : image.naturalWidth / image.naturalHeight;
      const fit = getComputedStyle(image).objectFit;
      // contain and scale-down keep the ratio of the picture whatever the box is.
      if (fit !== "contain" && fit !== "scale-down" && box.width > 25 && Math.abs(box.width / box.height / intrinsic - 1) > 0.02) {
        add("image-stretched", image, `box ratio ${(box.width / box.height).toFixed(2)} against ${intrinsic.toFixed(2)}`);
      }
      const parentBox = image.parentElement.getBoundingClientRect();
      if (box.left < parentBox.left - 1 || box.right > parentBox.right + 1 || box.top < parentBox.top - 1 || box.bottom > parentBox.bottom + 1) {
        add("image-outside-cell", image, "sticks out of its container");
      }
    }
    for (const drawing of document.querySelectorAll("svg[viewBox]")) {
      if (!isShown(drawing)) continue;
      const box = drawing.getBoundingClientRect();
      const [, , viewWidth, viewHeight] = drawing.getAttribute("viewBox").split(/[\s,]+/).map(Number);
      const stretches = drawing.getAttribute("preserveAspectRatio") === "none" && Math.abs(box.width / box.height / (viewWidth / viewHeight) - 1) > 0.02;
      if (stretches) add("svg-stretched", drawing, `box ratio ${(box.width / box.height).toFixed(2)} against ${(viewWidth / viewHeight).toFixed(2)}`);
    }
  }

  if (want("nav")) {
    const controls = [...document.querySelectorAll(".brand, .site-nav a, .language-switch a, .language-switch span")];
    for (const control of controls) {
      if (!isShown(control)) {
        add("nav-hidden", control, "not shown");
        continue;
      }
      const box = control.getBoundingClientRect();
      if (box.left < -1 || box.right > window.innerWidth + 1) add("nav-outside-viewport", control, `x ${Math.round(box.left)} to ${Math.round(box.right)}`);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit !== control && !control.contains(hit)) add("nav-covered", control, `covered by ${hit ? describe(hit) : "nothing"}`);
    }
    for (let first = 0; first < controls.length; first += 1) {
      for (let second = first + 1; second < controls.length; second += 1) {
        const { x, y } = overlapOf(controls[first].getBoundingClientRect(), controls[second].getBoundingClientRect());
        if (x > 1 && y > 1) add("nav-overlap", controls[first], `overlaps ${describe(controls[second])}`);
      }
    }
  }

  return issues;
}

// Clicks every link and compares where it lands with a literal expectation, never with its own href.
async function checkDestinations(page, specs, headerBottom, report) {
  for (const spec of specs) {
    try {
      await page.locator(spec.selector).first().click({ timeout: 4000 });
    } catch (error) {
      report("nav-click", `${spec.name}: ${error.message.split("\n")[0]}`);
      continue;
    }
    await page.waitForLoadState("load");
    await page.waitForTimeout(250);
    const landed = await page.evaluate((hash) => {
      const target = hash ? document.querySelector(hash) : null;
      const top = target ? target.getBoundingClientRect().top : null;
      return { path: location.pathname, hash: location.hash, top, viewport: window.innerHeight };
    }, spec.hash || "");
    // Cloudflare Pages serves /privacy and /privacy/ alike, so a trailing slash is not a different destination.
    const withoutSlash = (path) => (path.length > 1 ? path.replace(/\/$/, "") : path);
    if (withoutSlash(landed.path) !== withoutSlash(spec.path) || landed.hash !== (spec.hash || "")) {
      report("nav-wrong-destination", `${spec.name} went to ${landed.path}${landed.hash}, expected ${spec.path}${spec.hash || ""}`);
    } else if (spec.hash && (landed.top === null || landed.top < headerBottom - 2 || landed.top > landed.viewport - 50)) {
      report("nav-target-hidden", `${spec.name}: ${spec.hash} sits at ${landed.top === null ? "nothing" : Math.round(landed.top)}px, header bottom ${Math.round(headerBottom)}px`);
    }
    if (spec.reload) await page.goto(spec.reload, { waitUntil: "load" });
  }
}

const routeInfo = (route) => {
  const spanish = route === "/es/" || route.startsWith("/es/");
  const isMissing = route === MISSING_ROUTE;
  const home = spanish ? "/es/" : "/";
  const other = isMissing ? "/es/" : spanish ? route.slice(3) || "/" : `/es${route}`;
  return { home, other, isMissing };
};

function listRoutes() {
  const routes = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "index.html") routes.push(`/${path.slice("dist".length + 1, -"index.html".length)}`);
    }
  };
  if (!existsSync("dist")) throw new Error("dist/ is missing: run pnpm build first");
  walk("dist");
  if (!existsSync("dist/404.html")) throw new Error("dist/404.html is missing");
  return [...routes.sort(), MISSING_ROUTE];
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
  });
}

async function sweepCell({ browser, base, out, route, scheme, width, issues, counters }) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, colorScheme: scheme, reducedMotion: "reduce" });
  const page = await context.newPage();
  const slug = `${route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/\//g, "-")}__${scheme}__${width}`;
  const report = (check, detail, where = "page", state = "default") => issues.push({ route, scheme, width, state, check, where, detail });
  try {
    const response = await page.goto(`${base}${route}`, { waitUntil: "load" });
    const expected = routeInfo(route).isMissing ? 404 : 200;
    if (response.status() !== expected) report("http-status", `got ${response.status()}, expected ${expected}`);
    await settle(page);
    await page.screenshot({ path: join(out, `${slug}.png`), fullPage: true });
    for (const issue of await page.evaluate(pageChecks, { width, mobileMax: MOBILE_MAX_WIDTH, only: null })) report(issue.check, issue.detail, issue.where);

    if (route === "/" || route === "/es/") {
      // The beliefs list is closed by default, so its copy needs its own pass.
      await page.evaluate(() => { document.querySelector("details.beliefs").open = true; });
      for (const issue of await page.evaluate(pageChecks, { width, mobileMax: MOBILE_MAX_WIDTH, only: ["hscroll", "text"] })) report(issue.check, issue.detail, issue.where, "details-open");
      await page.evaluate(() => { document.querySelector("details.beliefs").open = false; });
    }

    // The skip link only exists on focus.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => {
      const element = document.activeElement;
      const box = element.getBoundingClientRect();
      return { isSkip: element.classList.contains("skip-link"), top: box.top, left: box.left, right: box.right, bottom: box.bottom };
    });
    if (!skip.isSkip) report("skip-link", "the first Tab stop is not the skip link");
    else if (skip.top < 0 || skip.left < 0 || skip.right > width || skip.bottom > VIEWPORT_HEIGHT) report("skip-link", "not fully inside the viewport on focus");
    await page.evaluate(() => document.activeElement.blur());

    if (scheme === "light") {
      const { home, other } = routeInfo(route);
      const headerBottom = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().bottom);
      const sections = SECTION_HASHES.map((hash, index) => ({ name: `nav link ${index + 1}`, selector: `.site-nav a:nth-of-type(${index + 1})`, path: home, hash, reload: `${base}${route}` }));
      await checkDestinations(
        page,
        [
          ...sections,
          { name: "brand", selector: ".brand", path: home, reload: `${base}${route}` },
          { name: "language link", selector: ".language-switch a", path: other, reload: `${base}${route}` },
        ],
        headerBottom,
        (check, detail) => report(check, detail),
      );
    }
    counters.cells += 1;
  } catch (error) {
    report("cell-failed", error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
}

// Scroll-linked motion and the sticky heading only exist with motion allowed, so they get their own pass.
async function sweepMotion({ browser, base, route, width, issues, counters }) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, colorScheme: "light", reducedMotion: "no-preference" });
  const page = await context.newPage();
  try {
    await page.goto(`${base}${route}`, { waitUntil: "load" });
    await settle(page);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let top = 0; top < total; top += Math.round(VIEWPORT_HEIGHT * 0.8)) {
      await page.evaluate((offset) => window.scrollTo({ top: offset, behavior: "instant" }), top);
      await page.waitForTimeout(120);
      for (const issue of await page.evaluate(pageChecks, { width, mobileMax: MOBILE_MAX_WIDTH, only: ["hscroll", "text"] })) {
        issues.push({ route, scheme: "light", width, state: `motion@${top}`, check: issue.check, where: issue.where, detail: issue.detail });
      }
    }
    counters.motion += 1;
  } catch (error) {
    issues.push({ route, scheme: "light", width, state: "motion", check: "cell-failed", where: "page", detail: error.message.split("\n")[0] });
  } finally {
    await context.close();
  }
}

// A page with one known defect per check and a few look-alikes that must stay quiet: a check that
// can never fire would otherwise read as "the site is clean".
const FIXTURE = `
<style>
  body { margin: 0; font: 16px/1.4 sans-serif; }
  header { position: relative; height: 80px; }
  header * { position: absolute; margin: 0; }
  .brand { left: 10px; top: 10px; width: 80px; height: 44px; }
  .site-nav a { top: 10px; width: 70px; height: 44px; display: block; }
  .language-switch span { left: 300px; top: 10px; width: 44px; height: 44px; }
  .cover { left: 130px; top: 10px; width: 70px; height: 44px; z-index: 5; background: #ccc; }
</style>
<header class="site-header">
  <a class="brand" data-case="brand-ok" href="#a">Brand</a>
  <nav class="site-nav"><a data-case="nav-covered" style="left:130px" href="#a">About</a><a data-case="nav-ok" style="left:210px" href="#a">Work</a></nav>
  <div class="cover"></div>
  <div class="language-switch"><span>EN</span></div>
</header>
<div data-case="hscroll" style="width:600px;height:10px"></div>
<div data-case="clip" style="overflow:hidden;width:60px;height:24px;white-space:nowrap">A very long line of text that gets cut</div>
<div style="position:relative;height:70px">
  <p data-case="overlap-a" style="position:absolute;left:10px;top:5px;margin:0">Overlapping text one</p>
  <p data-case="overlap-b" style="position:absolute;left:30px;top:12px;margin:0">Overlapping text two</p>
</div>
<p data-case="wrap-ok" style="width:120px;margin:0">This paragraph wraps onto several lines without any overlap</p>
<p><a data-case="tap-small" href="#a" style="display:inline-block;width:30px;height:30px">x</a></p>
<p class="action"><a data-case="cta-short" href="#a" style="display:inline-block">Go</a></p>
<ol><li>Write to <a data-case="inline-ok" href="mailto:a@b.c">a@b.c</a> today</li></ol>
<div style="width:210px;height:60px"><img data-case="img-stretched" width="100" height="100" style="width:200px;height:50px;object-fit:fill" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100'/%3E%3C/svg%3E" alt=""></div>
<div style="width:210px;height:60px"><img data-case="img-contain-ok" width="100" height="100" style="width:200px;height:50px;object-fit:contain" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100'/%3E%3C/svg%3E" alt=""></div>
<svg data-case="svg-none" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:200px;height:50px"><rect width="100" height="100"/></svg>
<svg data-case="svg-ok" viewBox="0 0 100 100" style="width:200px;height:50px"><rect width="100" height="100"/></svg>
<a id="to-a" href="#a">to a</a> <a id="to-wrong" href="#b">to b</a>
<div id="a" style="height:900px">section a</div><div id="b" style="height:900px">section b</div>
`;

async function selfTest(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: VIEWPORT_HEIGHT } });
  const page = await context.newPage();
  await page.setContent(FIXTURE);
  await settle(page);
  const found = await page.evaluate(pageChecks, { width: 390, mobileMax: MOBILE_MAX_WIDTH, only: null });
  const failures = [];
  const expectIssue = (check, caseName) => {
    if (!found.some((issue) => issue.check === check && (caseName === null || issue.where.includes(`case=${caseName}`) || issue.detail.includes(`case=${caseName}`)))) failures.push(`missing ${check} for ${caseName}`);
  };
  const expectQuiet = (caseName) => {
    for (const issue of found) if (issue.where.includes(`case=${caseName}`)) failures.push(`false positive ${issue.check} on ${caseName}`);
  };
  expectIssue("hscroll", null);
  expectIssue("text-clipped", "clip");
  expectIssue("text-overlap", "overlap-a");
  expectIssue("tap-target", "tap-small");
  expectIssue("tap-target", "cta-short");
  expectIssue("image-stretched", "img-stretched");
  expectIssue("svg-stretched", "svg-none");
  expectIssue("nav-covered", "nav-covered");
  for (const quiet of ["wrap-ok", "inline-ok", "img-contain-ok", "svg-ok", "nav-ok", "brand-ok"]) expectQuiet(quiet);

  const destinations = [];
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkDestinations(
    page,
    [
      { name: "link to a", selector: "#to-a", path: "blank", hash: "#a" },
      { name: "link to the wrong section", selector: "#to-wrong", path: "blank", hash: "#a" },
    ],
    0,
    (check, detail) => destinations.push({ check, detail }),
  );
  if (destinations.some((issue) => issue.detail.startsWith("link to a "))) failures.push("false positive on the correct link");
  if (!destinations.some((issue) => issue.check === "nav-wrong-destination" && issue.detail.startsWith("link to the wrong section"))) failures.push("missing nav-wrong-destination");
  await context.close();
  return failures;
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4400" }, out: { type: "string", default: "sweep/run" }, "self-test": { type: "boolean", default: false } } });
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error("set PLAYWRIGHT_MODULE to a playwright install (the site does not depend on it)");
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true });
  try {
    if (values["self-test"]) {
      const failures = await selfTest(browser);
      console.log(failures.length ? `self-test FAILED:\n${failures.join("\n")}` : "self-test passed: every check fires on its defect and stays quiet on its look-alike");
      process.exitCode = failures.length ? 1 : 0;
      return;
    }

    const routes = listRoutes();
    const issues = [];
    const counters = { cells: 0, motion: 0 };
    const jobs = [];
    for (const width of WIDTHS) for (const scheme of SCHEMES) for (const route of routes) jobs.push(() => sweepCell({ browser, base: values.base, out: values.out, route, scheme, width, issues, counters }));
    for (const width of MOTION_WIDTHS) for (const route of ["/", "/es/"]) jobs.push(() => sweepMotion({ browser, base: values.base, route, width, issues, counters }));
    const queue = [...jobs];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => { for (let job = queue.shift(); job; job = queue.shift()) await job(); }));

    // The Spanish 404 URL is not a separate document: it must answer 404 with the same page.
    const missing = [];
    for (const route of [MISSING_ROUTE, MISSING_ROUTE_ES]) {
      const response = await fetch(`${values.base}${route}`);
      const body = await response.text();
      if (response.status !== 404 || !/<html lang="en">/.test(body) || !body.includes("Page not found")) missing.push({ route, scheme: "-", width: 0, state: "http", check: "http-404", where: "page", detail: `status ${response.status}` });
    }
    issues.push(...missing);

    const expectedCells = WIDTHS.length * SCHEMES.length * routes.length;
    if (counters.cells !== expectedCells) issues.push({ route: "-", scheme: "-", width: 0, state: "run", check: "missing-cells", where: "page", detail: `${counters.cells} of ${expectedCells} cells finished` });
    // The JSON report goes to stdout (redirect it to a file); the readable summary goes to stderr.
    console.log(JSON.stringify({ routes, widths: WIDTHS, cells: counters.cells, issues }, null, 2));
    const grouped = new Map();
    for (const issue of issues) {
      const key = `${issue.check} | ${issue.route} | ${issue.where} | ${issue.detail}`;
      const entry = grouped.get(key) ?? { widths: new Set(), schemes: new Set() };
      entry.widths.add(issue.width);
      entry.schemes.add(issue.scheme);
      grouped.set(key, entry);
    }
    for (const [key, entry] of grouped) console.error(`${key} @ ${[...entry.widths].sort((a, b) => a - b).join(",")} (${[...entry.schemes].join(",")})`);
    console.error(`${routes.length} pages, ${counters.cells} cells, ${counters.motion} motion passes, ${issues.length} issue(s), ${grouped.size} distinct`);
    process.exitCode = issues.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
