# prototype.limited

Website of Prototype, an agentic AI engineering boutique from El Salvador.

Work is tracked in Jira, project PROTO ("PROTO - Sitio Prototype"). The epic PROTO-1 has the plan, the requirements and the conventions.

## Content

All copy lives in `content/`, one Markdown file per page and language:

- `content/en/`: English, the primary language, served at `/`.
- `content/es/`: Spanish, served at `/es/`, reachable from a language switch on every page.

Each file starts with front matter (`page`, `path`, `title`, `description`, and `last_updated` on legal pages). The site renders this content as written. Copy changes are made in `content/` and approved by Carlos, never invented or rewritten in code.

Pages: home, services, about, contact, privacy, terms, data-deletion. The three legal pages keep stable URLs because they are registered with Meta.

## Development

Astro, static output, no client JavaScript. Needs Node 24 (see `.nvmrc`; Astro requires 22.23.4 or newer) and pnpm.

```sh
pnpm install   # resolves only from registry.npmjs.org, pinned in .npmrc
pnpm dev       # local dev server at http://localhost:4321
pnpm build     # static files into dist/
pnpm test      # builds, then checks the acceptance criteria
```

`.npmrc` pins the public registry because some machines default to a private one. Never run an install before it exists.

## Deploy

Cloudflare Pages, connected to this repo: push to `main` deploys production, every PR gets a preview URL.

- Build command: `pnpm build`
- Build output directory: `dist`
- Production branch: `main`
- Node version: 24 (`NODE_VERSION=24`)

Do not enable Cloudflare Web Analytics: it injects a script, and the site has no analytics.

## Rules

- No cookies, analytics or tracking scripts.
- No em-dash character (U+2014) anywhere in the repo or the site.
- Commits, branches and PR titles carry the Jira key: `PROTO-N: ...`. One commit per PR.
