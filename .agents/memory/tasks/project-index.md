---
name: project-index
description: Task record for the 0.2.1 patch — human wiki pages, the .agents index tree, and an AGENTS.md entry point
status: in progress
---

# Task record — 0.2.1: wiki and indexes

## Goal

Make the repository navigable for people and agents: the facts in the README move into a
human wiki, and every tracked file becomes reachable from one root index, as the shared
`index-creator` and `information-creator` instructions require.

## Objective

- `wiki/information/` holds task-oriented pages for running, configuring, integrating, and
  developing the server; `README.md` is an overview that links to them.
- `.agents/index/root-index.md` routes to every index in the repository; each index follows
  the canonical template, and no `INDEX.md` exists anywhere.
- No index sits inside the scope it describes, so `wiki/logs/logs-index.md` moves to
  `.agents/index/project-wiki-logs-index.md`.
- `AGENTS.md` at the root points agents at the root index.
- Version `0.2.1` (patch), approved by the owner.

## Decisions agreed with the owner

- The owner asked for a patch release and allowed opening the pull requests and merging them
  in order without a further human review.
- No runtime code changes; the API, schema, and dependencies stay as in 0.2.0.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | LXAuth/server-expressjs | `plan/project-index` | `.agents/memory/tasks/` | |
| 2 | Human wiki | Information pages, README overview | LXAuth/server-expressjs | `docs/wiki` | `wiki/information/`, `README.md` | |
| 3 | Indexes | Root, wiki, logs, and memory indexes; AGENTS.md | LXAuth/server-expressjs | `docs/index` | `.agents/index/`, `AGENTS.md`, `wiki/logs/` | |
| 4 | Release | Version, changelog, audit, PR column | LXAuth/server-expressjs | `release/0.2.1` | `package.json`, `wiki/logs/0/2/1/` | |

## Progress

### Task 1 — plan/project-index

Landed: this record. Next: task 2 writes the human wiki.
