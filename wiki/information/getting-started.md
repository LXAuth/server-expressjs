# Getting started

Run the LXAuth server locally against PostgreSQL and open its API reference.

## Requirements

- Node.js 22.12 or later
- PostgreSQL 14 or later. The repository's `docker-compose.yml` starts PostgreSQL 18.

## Run it

```bash
cp .env.example .env            # then set DATABASE_URL and, optionally, providers
docker compose up -d db         # or point DATABASE_URL at your own PostgreSQL
npm install
npm run build
npm start                       # applies migrations, then listens on PORT
```

Open `http://localhost:3000/api` for the API reference. It lists every endpoint the server
accepts; any other URL answers `404 {"message":"Not found"}`.

For development, `npm run dev` runs the TypeScript source and reloads on change. It reads
`.env` when the file exists.

## Migrations

`npm start` applies pending migrations before it listens. To apply them on their own:

```bash
npm run migrate        # from the build in dist/
npm run migrate:dev    # from the TypeScript source
```

Migrations are plain SQL files in `migrations/`, applied in filename order and recorded in
the `schema_migrations` table. A PostgreSQL advisory lock keeps two instances that start
together from applying the same file twice.

## Next

- [Configuration](configuration.md) lists every environment variable.
- [Client integration](client-integration.md) shows how an application logs users in.
