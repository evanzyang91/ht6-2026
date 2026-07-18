# Engineering Memory dashboard

A restrained, server-rendered view of recurring pull request feedback. It shows the three most
frequent review comments, category distribution, accepted-fix coverage, and reviewer activity.

## Local development

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```

Without environment variables the page uses clearly labeled demo data. To use repository memory,
start `packages/api-server` and set:

```dotenv
ENGINEERING_MEMORY_API_URL=http://127.0.0.1:8790/graphql
ENGINEERING_MEMORY_REPOSITORY=owner/repository
ENGINEERING_MEMORY_GITHUB_TOKEN=<server-only GitHub token>
```

The token is read only by the Next.js server component and is never sent to the browser.

## Deploy on Vercel

Import this repository into Vercel and set **Root Directory** to `dashboard`. Add the three variables
above in Project Settings → Environment Variables, then deploy. Vercel detects the checked-in Next.js
configuration and runs `npm run build`.

For a public production dashboard, replace the personal GitHub token with an authenticated backend
session or GitHub App installation token. The current environment-token setup is appropriate for a
private hackathon deployment, not a public multi-tenant product.
