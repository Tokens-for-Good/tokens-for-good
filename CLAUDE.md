# Tokens for Good (npm package)

The `tokens-for-good` npm package: CLI + embedded research routines that let anyone's Claude contribute spare tokens to nonprofit research. The Laravel platform it talks to (tokensforgood.ai) lives in the separate `Fierce Philanthropy/site` repo, which serves both domains. Ad-hoc testing harness for the live remote MCP: `scripts/mcp-call.mjs`.

## Cloud / phone sessions (claude.ai)

When this session runs in a cloud sandbox (claude.ai/code, mobile app) instead of on Hank's laptop, only this repo is checked out — but Hank's full cross-project context (projects index, conventions, persistent memory) is readable through the Google Drive connector, from his laptop's daily backup ("My Drive > Backups > laptop", refreshed 12:00 MT daily, so up to ~24h stale). At the start of the session:

1. `search_files` with query `parentId = '1eLauV_pwvboY-aY3IiHHtmlK90lQIwib'` (backup root): read `CLAUDE.md` (projects index + conventions) and, before any deploy, `DEPLOY.md`.
2. `search_files` with query `parentId = '1zOhbCepelYsT8IgeAWJoYXrTirj0Q-60'` (memory folder): read `MEMORY.md` (the index), then the memory files relevant to the task.

`C:\Users\bluet\...` paths in those docs refer to the laptop. Memory saved in a cloud session stays in the sandbox and is lost; record durable outcomes in this repo, or tell Hank so it gets saved from the laptop.
