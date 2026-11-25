import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REGISTRY_URL = "https://registry.npmjs.org/";
const EM_DASH = String.fromCharCode(0x2014);

// Build once and capture the result instead of throwing, so every test below
// runs and fails on its own even when the build is missing (red commit).
let buildResult;
before(() => {
  buildResult = spawnSync("pnpm", ["build"], { encoding: "utf8" });
});

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function listFilesRecursively(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    return statSync(fullPath).isDirectory() ? listFilesRecursively(fullPath) : [fullPath];
  });
}

function frontMatterTitle(markdownPath) {
  const match = readText(markdownPath).match(/^title:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

describe("static build and scripts", () => {
  test("given the repo when pnpm build runs then it succeeds and emits dist/index.html", () => {
    assert.equal(buildResult.status, 0, buildResult.stderr);
    assert.ok(existsSync("dist/index.html"));
  });

  test("given package.json when read then build and dev scripts exist", () => {
    const scripts = JSON.parse(readText("package.json") || "{}").scripts ?? {};
    assert.ok(scripts.build, "build script missing");
    assert.ok(scripts.dev, "dev script missing");
  });

  test("given the README when read then it documents pnpm build and pnpm dev", () => {
    const readme = readText("README.md");
    assert.match(readme, /pnpm build/);
    assert.match(readme, /pnpm dev/);
  });
});

describe("registry pinning", () => {
  test("given .npmrc when read then it pins the public registry", () => {
    assert.equal(readText(".npmrc").trim(), `registry=${REGISTRY_URL}`);
  });

  test("given the repo when pnpm resolves config then the default registry is the public one", () => {
    const registry = spawnSync("pnpm", ["config", "get", "registry"], { encoding: "utf8" }).stdout.trim();
    assert.equal(registry, REGISTRY_URL);
  });

  test("given pnpm config when listed then no scoped registry points elsewhere", () => {
    const configList = spawnSync("pnpm", ["config", "list"], { encoding: "utf8" }).stdout;
    const scopedRegistries = configList.split("\n").filter((line) => /^@[^:]+:registry/.test(line.trim()));
    // @jsr is pnpm's own built-in public default, not a corporate override.
    for (const line of scopedRegistries) {
      assert.ok(line.includes(REGISTRY_URL) || line.includes("https://npm.jsr.io/"), `foreign scoped registry: ${line}`);
    }
  });

  test("given the lockfile when read then it resolves astro and only from the public registry", () => {
    const lockfile = readText("pnpm-lock.yaml");
    assert.match(lockfile, /astro@/);
    const hosts = [...lockfile.matchAll(/https?:\/\/([^/\s'"]+)/g)].map((match) => match[1]);
    for (const host of hosts) {
      assert.equal(host, "registry.npmjs.org", `foreign host in lockfile: ${host}`);
    }
  });
});

describe("content loading", () => {
  test("given the content config when read then both language folders are loaded", () => {
    const contentConfig = readText("src/content.config.ts");
    assert.ok(contentConfig.includes("./content/en"));
    assert.ok(contentConfig.includes("./content/es"));
  });

  test("given a build when finished then all 7 pages of each language were loaded and validated", () => {
    const dataStore = readText("node_modules/.astro/data-store.json");
    for (const language of ["en", "es"]) {
      const loadedFiles = new Set(dataStore.match(new RegExp(`content/${language}/[a-z-]+\\.md`, "g")));
      assert.equal(loadedFiles.size, 7, `${language} pages loaded`);
    }
  });

  test("given content/en/home.md when built then the home title tag equals its front matter title", () => {
    const expectedTitle = frontMatterTitle("content/en/home.md");
    assert.ok(expectedTitle);
    assert.ok(readText("dist/index.html").includes(`<title>${expectedTitle}</title>`), "title tag missing");
  });

  test("given a build when finished then content/ is untouched", () => {
    assert.equal(execFileSync("git", ["status", "--porcelain", "content"], { encoding: "utf8" }), "");
  });
});

describe("cloudflare documentation", () => {
  test("given the README when read then it documents build command, output folder and Node version", () => {
    const readme = readText("README.md");
    const nodeVersion = readText(".nvmrc").trim();
    assert.ok(nodeVersion, ".nvmrc missing");
    assert.match(readme, /pnpm build/);
    assert.match(readme, /\bdist\b/);
    assert.ok(readme.includes(nodeVersion), "Node version not documented");
  });
});

describe("no tracking in the built output", () => {
  const distFiles = () => listFilesRecursively("dist");

  test("given dist when built then JavaScript files exist only under the bundled assets folder", () => {
    assert.ok(distFiles().length > 0, "dist is empty");
    const scripts = distFiles().filter((file) => /\.(m?js)$/.test(file));
    assert.deepEqual(scripts.filter((file) => !file.startsWith(join("dist", "_astro"))), []);
  });

  test("given dist when scanned then no external script, cookie or tracker patterns exist", () => {
    assert.ok(distFiles().length > 0, "dist is empty");
    const forbidden = [/<script\b[^>]*\bsrc=["'](https?:)?\/\//i, /document\.cookie/i, /set-cookie/i, /gtag\(/i, /googletagmanager\.com/i];
    for (const file of distFiles()) {
      const content = readText(file);
      for (const pattern of forbidden) {
        assert.doesNotMatch(content, pattern, `${file} matches ${pattern}`);
      }
    }
  });

  test("given dist HTML when scanned then nothing loads from another origin", () => {
    const wholeTag = /<(script|link|img|iframe|source)\b[^>]*>/gi;
    const externalReference = /\b(src|href)=["'](https?:)?\/\//i;
    // hreflang alternates are navigation hints, not loaded resources; skip only
    // those pointing at our own domain, whatever the attribute order.
    const isOwnAlternate = (tag) => /\brel=["']?alternate\b/i.test(tag) && /\bhref=["']https:\/\/prototype\.limited/i.test(tag);
    for (const file of distFiles().filter((name) => name.endsWith(".html"))) {
      const offenders = (readText(file).match(wholeTag) ?? []).filter(
        (tag) => externalReference.test(tag) && !(/^<link\b/i.test(tag) && isOwnAlternate(tag)),
      );
      assert.deepEqual(offenders, [], `${file} loads an external resource`);
    }
  });
});

describe("no em-dash", () => {
  test("given tracked and untracked repo files plus dist when scanned then none contains U+2014", () => {
    const repoFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const allFiles = [...repoFiles, ...listFilesRecursively("dist")].filter((file) => existsSync(file));
    const offenders = allFiles.filter((file) => readText(file).includes(EM_DASH));
    assert.deepEqual(offenders.map((file) => relative(".", file)), []);
  });
});
