import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations should bypass production connection poolers. Locally, DIRECT_URL can be omitted
// and both Prisma CLI and extraction use the same Docker PostgreSQL connection.
// Client generation and schema validation do not connect, but still require a valid URL.
const databaseUrl = process.env.DIRECT_URL
  ?? process.env.DATABASE_URL
  ?? "postgresql://postgres:postgres@localhost:5432/engineering_memory?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
