<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification preference

- The user tests browser flows manually. Do not run browser automation unless they explicitly request it.
- After code-level checks, provide a short, concrete manual browser test checklist to save tokens.

## Milestone completion

- After completing and verifying each milestone, create a scoped Git commit containing that milestone's changes. Preserve unrelated worktree changes and report the commit hash.
