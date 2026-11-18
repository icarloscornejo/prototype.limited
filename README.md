# prototype.limited

Website of Prototype, an agentic AI engineering boutique from El Salvador.

Work is tracked in Jira, project PROTO ("PROTO - Sitio Prototype"). The epic PROTO-1 has the plan, the requirements and the conventions.

## Content

All copy lives in `content/`, one Markdown file per page and language:

- `content/en/`: English, the primary language, served at `/`.
- `content/es/`: Spanish, served at `/es/`, reachable from a language switch on every page.

Each file starts with front matter (`page`, `path`, `title`, `description`, and `last_updated` on legal pages). The site renders this content as written. Copy changes are made in `content/` and approved by Carlos, never invented or rewritten in code.

Pages: home, services, about, contact, privacy, terms, data-deletion. The three legal pages keep stable URLs because they are registered with Meta.

## Rules

- No cookies, analytics or tracking scripts.
- No em-dash character (U+2014) anywhere in the repo or the site.
- Commits, branches and PR titles carry the Jira key: `PROTO-N: ...`. One commit per PR.
