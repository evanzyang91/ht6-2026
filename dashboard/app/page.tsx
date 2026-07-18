import { loadDashboardData } from "../lib/dashboard-data";

export const dynamic = "force-dynamic";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function DashboardPage() {
  const data = await loadDashboardData();
  const maxCategoryCount = Math.max(...data.categories.map((item) => item.count), 1);

  return (
    <main className="page-shell">
      <section className="page-heading">
        <div>
          <h1>Pull request review analytics</h1>
          <p className="lede">
            The conventions reviewers repeat most, how often they appear, and where accepted fixes
            are becoming standard practice.
          </p>
        </div>
        <div className="heading-context">
          <span>{data.source === "live" ? "Live memory" : "Demo data"}</span>
          <span>{data.repository}</span>
          <span className="period-label">All merged PRs</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Review summary">
        <article className="metric-card">
          <span className="metric-label">Comments analyzed</span>
          <strong>{data.summary.commentsAnalyzed}</strong>
          <span className="metric-detail">Across {data.summary.pullRequests} pull requests</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Recurring conventions</span>
          <strong>{data.summary.conventions}</strong>
          <span className="metric-detail">Patterns with reusable evidence</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Accepted fix rate</span>
          <strong>{formatPercent(data.summary.acceptedFixRate)}</strong>
          <span className="metric-detail">Comments linked to merged fixes</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active reviewers</span>
          <strong>{data.summary.reviewers}</strong>
          <span className="metric-detail">Contributing repository knowledge</span>
        </article>
      </section>

      <section className="primary-grid">
        <article className="panel frequent-panel">
          <div className="panel-heading">
            <div>
              <h2>Most frequent PR comments</h2>
            </div>
            <span className="panel-note">Top 3</span>
          </div>

          <ol className="comment-list">
            {data.topComments.map((comment, index) => (
              <li key={comment.id} className="comment-row">
                <span className="rank" aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
                <div className="comment-copy">
                  <blockquote>“{comment.comment}”</blockquote>
                  <div className="comment-meta">
                    <span className="category-pill">{comment.category}</span>
                    <span>{comment.pullRequests} supporting PRs</span>
                    <span>{formatPercent(comment.confidence)} confidence</span>
                  </div>
                </div>
                <div className="frequency">
                  <strong>{comment.count}</strong>
                  <span>mentions</span>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="panel category-panel">
          <div className="panel-heading">
            <div>
              <h2>Review categories</h2>
            </div>
          </div>
          <div className="category-list">
            {data.categories.map((category) => (
              <div className="category-row" key={category.name}>
                <div className="category-label-row">
                  <span>{category.name}</span>
                  <span>{category.count}</span>
                </div>
                <div className="bar-track" aria-label={`${category.name}: ${category.count} comments`}>
                  <span className="bar-fill" style={{ width: `${(category.count / maxCategoryCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="secondary-grid">
        <article className="panel outcome-panel">
          <div className="panel-heading">
            <div>
              <h2>Accepted fix coverage</h2>
            </div>
            <strong className="coverage-value">{formatPercent(data.summary.acceptedFixRate)}</strong>
          </div>
          <div className="coverage-track" aria-label={`${formatPercent(data.summary.acceptedFixRate)} accepted fix coverage`}>
            <span style={{ width: formatPercent(data.summary.acceptedFixRate) }} />
          </div>
          <div className="coverage-legend">
            <span><i className="legend-swatch accepted" />Linked to accepted code</span>
            <span><i className="legend-swatch unresolved" />No accepted replacement found</span>
          </div>
        </article>

        <article className="panel reviewer-panel">
          <div className="panel-heading">
            <div>
              <h2>Reviewer activity</h2>
            </div>
          </div>
          <div className="reviewer-table" role="table" aria-label="Reviewer activity">
            {data.reviewers.map((reviewer) => (
              <div className="reviewer-row" role="row" key={reviewer.name}>
                <span className="avatar" aria-hidden="true">{reviewer.initials}</span>
                <span className="reviewer-name" role="cell">{reviewer.name}</span>
                <span className="reviewer-count" role="cell">{reviewer.comments} comments</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer>
        <span>Updated from merged pull request history</span>
        <span>{data.source === "live" ? "Connected to Engineering Memory API" : "Connect the API to replace demo data"}</span>
      </footer>
    </main>
  );
}
