---
name: root-index
description: Index of the whole repository — every index, and when to load it.
---

# Root Index

**Scope:** `.agents/` and `wiki/`
**Parent:** none — this is the root.

## Child Indexes

| Index | Scope | Load when |
|---|---|---|
| [`memory-index.md`](memory-index.md) | `.agents/memory/` — task records | Starting any request, to continue earlier work instead of restarting it |
| [`project-wiki-index.md`](project-wiki-index.md) | `wiki/` — human documentation | Reading or changing how the server is run, configured, integrated, or developed |
| [`project-wiki-logs-index.md`](project-wiki-logs-index.md) | `wiki/logs/` — release notes | Preparing a release, or checking what a version changed |
