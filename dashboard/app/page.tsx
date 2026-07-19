import { loadDashboardData } from "../lib/dashboard-data";

export const dynamic = "force-dynamic";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function DashboardPage() {
  const data = await loadDashboardData();
  const pullRequests = new Set(data.reviewEpisodes.map((episode) => episode.pullRequest)).size;
  const reviewers = new Set(data.reviewEpisodes.map((episode) => episode.reviewer)).size;

  return (
    <main className="page-shell">
      <section className="page-heading">
        <div>
          <h1>Engineering memory</h1>
          <p className="lede">
            Conventions and review episodes loaded directly from the GraphQL API.
          </p>
        </div>
        <div className="heading-context">
          <span>{data.connection === "live" ? "Live API" : "API unavailable"}</span>
          <span>{data.repository}</span>
          {data.status ? <span>{data.status}</span> : null}
        </div>
      </section>

      {data.connection !== "live" ? (
        <section className="connection-banner error">
          <strong>Repository memory could not be loaded.</strong>
          <span>{data.error}</span>
        </section>
      ) : null}

      <section className="metric-grid" aria-label="Repository memory summary">
        <article className="metric-card">
          <span className="metric-label">Conventions</span>
          <strong>{data.conventions.length}</strong>
          <span className="metric-detail">Published recurring patterns</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Review episodes</span>
          <strong>{data.reviewEpisodes.length}</strong>
          <span className="metric-detail">Evidence returned by GraphQL</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Pull requests</span>
          <strong>{pullRequests}</strong>
          <span className="metric-detail">Represented in the evidence</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Reviewers</span>
          <strong>{reviewers}</strong>
          <span className="metric-detail">Contributors to repository memory</span>
        </article>
      </section>

      <section className="data-stack">
        <article className="panel">
          <div className="panel-heading">
            <h2>Conventions</h2>
            <span className="panel-note">{data.conventions.length} records</span>
          </div>
          <div className="record-list">
            {data.conventions.map((convention) => (
              <section className="record-card" key={convention.id}>
                <div className="record-heading">
                  <div>
                    <span className="category-pill">{convention.category}</span>
                    <h3>{convention.title}</h3>
                  </div>
                  <strong>{formatPercent(convention.confidence)}</strong>
                </div>
                <p className="record-rule">{convention.rule}</p>
                <p className="record-rationale">{convention.rationale}</p>
                <div className="record-meta">
                  <span>{convention.supportingEpisodes.length} supporting episodes</span>
                  {convention.languages.length ? <span>{convention.languages.join(", ")}</span> : null}
                  {convention.pathScopes.length ? <span>{convention.pathScopes.join(", ")}</span> : null}
                </div>
              </section>
            ))}
            {data.connection === "live" && !data.conventions.length ? (
              <p className="empty-state">No published conventions were returned for this repository.</p>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Review episodes</h2>
            <span className="panel-note">{data.reviewEpisodes.length} records</span>
          </div>
          <div className="record-list">
            {data.reviewEpisodes.map((episode) => (
              <section className="record-card episode-card" key={episode.id}>
                <div className="record-heading">
                  <div>
                    <span className="episode-pr">PR #{episode.pullRequest}</span>
                    <h3>{episode.filePath}</h3>
                  </div>
                  <strong>@{episode.reviewer}</strong>
                </div>
                <blockquote>“{episode.reviewComment}”</blockquote>
                <div className="code-comparison">
                  <div>
                    <span>Rejected</span>
                    <pre>{episode.rejectedCode}</pre>
                  </div>
                  <div>
                    <span>Accepted</span>
                    <pre>{episode.acceptedCode || "No accepted replacement recorded"}</pre>
                  </div>
                </div>
              </section>
            ))}
            {data.connection === "live" && !data.reviewEpisodes.length ? (
              <p className="empty-state">No review episodes were returned for this repository.</p>
            ) : null}
          </div>
        </article>
      </section>

      <footer>
        <span>{data.repository}</span>
        <span>Read directly from Engineering Memory GraphQL</span>
      </footer>
    </main>
  );
}
