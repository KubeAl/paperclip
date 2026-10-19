import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const projectId = { type: "string", description: "Project id (the task's projectId)." };

const manifest: PaperclipPluginManifestV1 = {
  id: "shellkube.dashboard",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Project dashboard (Shellkube)",
  description: "An agent keeps a dashboard on a project. Users open a discussion on any value, set targets, and drag plan items to a day.",
  author: "Shellkube",
  categories: ["ui", "automation"],
  capabilities: [
    "projects.read", "issues.read", "issues.create", "issues.wakeup", "issue.comments.create",
    "issue.comments.create_human_attributed", "plugin.state.read", "plugin.state.write",
    "agent.tools.register", "ui.detailTab.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  tools: [
    {
      name: "dashboard_get", displayName: "Dashboard: read",
      description: "Read the project's dashboard plus what users added: targets (and which values miss them), open discussions on values, and plan dates users moved.",
      parametersSchema: { type: "object", required: ["projectId"], properties: { projectId } },
    },
    {
      name: "dashboard_update", displayName: "Dashboard: update",
      description: "Create or replace sections of the project's dashboard (matched by section id; new ids are appended). Read first: keep item dates users moved. See the dashboard skill for widget kinds.",
      parametersSchema: { type: "object", required: ["projectId"], properties: {
        projectId, title: { type: "string" },
        sections: { type: "array", items: { type: "object" } },
        removeSections: { type: "array", items: { type: "string" } } } },
    },
  ],
  ui: {
    slots: [
      { type: "detailTab", id: "dashboard", displayName: "Dashboard", exportName: "ProjectDashboard", entityTypes: ["project"] },
    ],
  },
};

export default manifest;
