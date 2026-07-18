# Engineering Memory GraphQL API

Authenticated application boundary shared by the VS Code extension and future web clients. It
exposes domain operations rather than database CRUD: inspect memory, retrieve conventions, validate
a diff, and request repository synchronization.

## Local development

```bash
cp packages/api-server/.env.example packages/api-server/.env
npm run db:setup
npm run api-server
```

The GraphQL endpoint and GraphiQL UI are available at `http://127.0.0.1:8790/graphql`. Requests must
send a VS Code/GitHub OAuth token as `Authorization: Bearer <token>`. The server verifies that token
can read the requested GitHub repository and caches successful checks for five minutes.

When `DATABASE_READ_URL` is configured, queries read the repository's active published extraction
run from PostgreSQL. `requestRepositorySync` performs ingestion with the ephemeral GitHub token and
invokes extraction, which publishes with `DATABASE_URL`. The token is never written to disk.

## Production

- `DATABASE_URL`: pooled extraction-writer Supabase connection.
- `DATABASE_READ_URL`: pooled read-only Supabase connection.
- Prisma migrations run separately with extraction's `DIRECT_URL` and `db:deploy` command.
- Bind `API_HOST=0.0.0.0` in a container or hosted service.
