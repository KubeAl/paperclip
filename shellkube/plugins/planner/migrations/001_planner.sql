CREATE TABLE IF NOT EXISTS plugin_planner_8a0184621c.task_dates (
  issue_id uuid PRIMARY KEY REFERENCES public.issues(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  due_on date,
  start_on date,
  auto_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_dates_company_due ON plugin_planner_8a0184621c.task_dates (company_id, due_on);
CREATE INDEX IF NOT EXISTS task_dates_company_start ON plugin_planner_8a0184621c.task_dates (company_id, start_on);
CREATE TABLE IF NOT EXISTS plugin_planner_8a0184621c.bookmarks (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  tag text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookmarks_company ON plugin_planner_8a0184621c.bookmarks (company_id, tag);
