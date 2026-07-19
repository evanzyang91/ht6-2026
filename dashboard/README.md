# Engineering Memory dashboard

A server-rendered view of conventions and review episodes returned by the Engineering Memory
GraphQL API. The dashboard does not authenticate with GitHub or call the GitHub API.

## Local development

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```

Configure the GraphQL endpoint and repository in `.env.local`:

```dotenv
ENGINEERING_MEMORY_API_URL=http://127.0.0.1:8790/graphql
ENGINEERING_MEMORY_REPOSITORY=owner/repository
```

## Deploy on Vercel

Import this repository into Vercel and set **Root Directory** to `dashboard`. Add
`ENGINEERING_MEMORY_API_URL` with the Render GraphQL URL and `ENGINEERING_MEMORY_REPOSITORY` with the
repository slug in Project Settings → Environment Variables, then deploy.
