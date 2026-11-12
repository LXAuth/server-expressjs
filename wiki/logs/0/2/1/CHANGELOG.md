# 0.2.1 — 2026-11-12

Documentation and repository navigation only. The API, the database schema, and the
dependencies are unchanged from 0.2.0, so there is nothing to migrate.

## Added

- Human documentation under `wiki/information/`: getting started, configuration, client
  integration, security model, and development.
- An index tree under `.agents/index/` that reaches every task record and wiki page, and an
  `AGENTS.md` entry point for agents.

## Changed

- `README.md` is now an overview with a quick start; the details moved to the wiki pages.

## Removed

- `wiki/logs/logs-index.md`. Release notes are indexed in
  `.agents/index/project-wiki-logs-index.md`.
