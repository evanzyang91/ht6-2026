-- Production target: PostgreSQL. Enable pgvector when semantic retrieval is added.
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE repositories (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  default_branch text,
  ingested_through timestamptz
);

CREATE TABLE pull_requests (
  repository_id bigint NOT NULL REFERENCES repositories(id),
  number integer NOT NULL,
  title text NOT NULL,
  author text,
  merged_at timestamptz,
  merge_commit_sha text,
  PRIMARY KEY (repository_id, number)
);

CREATE TABLE review_comments (
  id text PRIMARY KEY,
  repository_id bigint NOT NULL REFERENCES repositories(id),
  pull_request_number integer NOT NULL,
  reviewer text NOT NULL,
  body text NOT NULL,
  file_path text NOT NULL,
  original_commit_sha text NOT NULL,
  original_line integer,
  diff_hunk text,
  created_at timestamptz NOT NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (repository_id, pull_request_number)
    REFERENCES pull_requests(repository_id, number)
);

CREATE TABLE review_episodes (
  id text PRIMARY KEY,
  review_comment_id text NOT NULL UNIQUE REFERENCES review_comments(id),
  intent text NOT NULL,
  rejected_code text NOT NULL,
  accepted_code text,
  accepted_fix_quality text NOT NULL CHECK (accepted_fix_quality IN ('high', 'medium', 'unknown')),
  extractor_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conventions (
  id text PRIMARY KEY,
  repository_id bigint NOT NULL REFERENCES repositories(id),
  title text NOT NULL,
  rule text NOT NULL,
  rationale text NOT NULL,
  category text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('candidate', 'active', 'deprecated')),
  supersedes_id text REFERENCES conventions(id),
  compiler_version text NOT NULL,
  -- embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE convention_evidence (
  convention_id text NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES review_episodes(id),
  evidence_weight real NOT NULL DEFAULT 1,
  PRIMARY KEY (convention_id, episode_id)
);

CREATE TABLE convention_scopes (
  convention_id text NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  path_glob text NOT NULL,
  language text,
  PRIMARY KEY (convention_id, path_glob, language)
);

CREATE TABLE convention_signals (
  convention_id text NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prohibited', 'preferred')),
  matcher_type text NOT NULL CHECK (matcher_type IN ('text', 'import', 'call', 'ast')),
  value text NOT NULL,
  PRIMARY KEY (convention_id, kind, matcher_type, value)
);

CREATE INDEX review_comments_repo_path_idx ON review_comments(repository_id, file_path);
CREATE INDEX conventions_repo_status_idx ON conventions(repository_id, status);
CREATE INDEX evidence_episode_idx ON convention_evidence(episode_id);
