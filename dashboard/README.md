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
DASHBOARD_BASE_URL=http://127.0.0.1:3000
GITHUB_CLIENT_ID=<GitHub OAuth App client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth App client secret>
GITHUB_OAUTH_SCOPE=repo
DASHBOARD_AUTH_SECRET=<random server-only secret>
```

Register a GitHub OAuth App with homepage URL `http://127.0.0.1:3000` and callback URL
`http://127.0.0.1:3000/api/auth/github/callback`. Generate `DASHBOARD_AUTH_SECRET` with
`openssl rand -hex 32`. The OAuth token is encrypted into an HTTP-only, same-site session cookie
and is only used server-side when calling the Engineering Memory API.

## Deploy on Vercel

Import this repository into Vercel and set **Root Directory** to `dashboard`. Add the three variables
above in Project Settings → Environment Variables, then deploy. Vercel detects the checked-in Next.js
configuration and runs `npm run build`.

For production, register an OAuth App whose homepage and callback use the deployed dashboard URL.
GitHub OAuth Apps support one callback URL, so local and production usually use separate app
registrations. Keep `GITHUB_CLIENT_SECRET` and `DASHBOARD_AUTH_SECRET` in deployment secrets.
