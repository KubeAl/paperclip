import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "shellkube.planner",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Planner (Shellkube)",
  description: "Due and start dates on tasks, a calendar of pending work and routine runs, and bookmarks.",
  author: "Shellkube",
  categories: ["ui", "automation"],
  capabilities: [
    "database.namespace.migrate", "database.namespace.read", "database.namespace.write",
    "issues.read", "issues.update", "jobs.schedule",
    "ui.page.register", "ui.sidebar.register", "ui.detailTab.register", "ui.dashboardWidget.register",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      autoStart: { type: "boolean", title: "Auto-start tasks on their start date", default: true },
    },
  },
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  database: { namespaceSlug: "planner", migrationsDir: "migrations", coreReadTables: ["issues", "agents"] },
  jobs: [{ jobKey: "auto-start", displayName: "Start scheduled tasks",
    description: "Moves backlog tasks to todo when their start date arrives (wakes the agent).", schedule: "*/15 * * * *" }],
  ui: {
    slots: [
      { type: "page", id: "calendar", displayName: "Calendar", exportName: "CalendarPage", routePath: "calendar" },
      { type: "page", id: "bookmarks", displayName: "Bookmarks", exportName: "BookmarksPage", routePath: "bookmarks" },
      { type: "sidebar", id: "calendar-link", displayName: "Calendar", exportName: "CalendarSidebarLink" },
      { type: "sidebar", id: "bookmarks-link", displayName: "Bookmarks", exportName: "BookmarksSidebarLink" },
      { type: "taskDetailView", id: "schedule", displayName: "Schedule", exportName: "TaskSchedule", entityTypes: ["issue"] },
      { type: "dashboardWidget", id: "due-widget", displayName: "Due soon", exportName: "DueWidget" },
    ],
  },
};

export default manifest;
