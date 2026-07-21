import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import {
  availableApps,
  filterToolsByApps,
  parseAppIdsFromMessage,
} from "./apps-config";
import type { MyMessage } from "./route";

const placeholderTool = {} as ToolSet[string];

describe("apps config", () => {
  it("defines each configured MCP integration", () => {
    expect(
      availableApps.map(({ id, name, toolPrefix }) => ({
        id,
        name,
        toolPrefix,
      }))
    ).toEqual([
      {
        id: "calendar",
        name: "Calendar",
        toolPrefix: "google_calendar_",
      },
      {
        id: "tasks",
        name: "Tasks",
        toolPrefix: "google_tasks_",
      },
      {
        id: "docs",
        name: "Docs",
        toolPrefix: "google_docs_",
      },
    ]);
  });

  it("returns tools for only the selected apps", () => {
    const tools: ToolSet = {
      google_calendar_find_events: placeholderTool,
      google_docs_find_a_document: placeholderTool,
      google_tasks_create_task: placeholderTool,
      unrelated_tool: placeholderTool,
    };

    expect(Object.keys(filterToolsByApps(tools, ["calendar", "docs"]))).toEqual(
      ["google_calendar_find_events", "google_docs_find_a_document"]
    );
    expect(Object.keys(filterToolsByApps(tools, ["tasks"]))).toEqual([
      "google_tasks_create_task",
    ]);
    expect(filterToolsByApps(tools, [])).toEqual({});
    expect(filterToolsByApps(tools, ["unknown"])).toEqual({});
  });

  it("extracts unique app tags in message order", () => {
    const message = {
      id: "message-1",
      role: "user",
      parts: [
        { type: "data-app-tag", data: { appId: "calendar" } },
        { type: "text", text: "Plan my day" },
        { type: "data-app-tag", data: { appId: "tasks" } },
        { type: "data-app-tag", data: { appId: "calendar" } },
      ],
    } as MyMessage;

    expect(parseAppIdsFromMessage(message)).toEqual(["calendar", "tasks"]);
    expect(parseAppIdsFromMessage(undefined)).toEqual([]);
  });
});
