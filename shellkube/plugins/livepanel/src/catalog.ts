// The components and actions agents may use in a live panel spec. Shared by the UI and the prompt doc.
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions as d } from "@json-render/shadcn/catalog";
import { z } from "zod";

export const NAMES = ["Card", "Stack", "Grid", "Separator", "Heading", "Text", "Badge", "Alert", "Table", "Progress",
  "Input", "Textarea", "Select", "Checkbox", "Radio", "Switch", "Slider", "Button", "ButtonGroup"] as const;

export const catalog = defineCatalog(schema, {
  components: {
    ...(Object.fromEntries(NAMES.map((n) => [n, d[n]])) as { [K in (typeof NAMES)[number]]: (typeof d)[K] }),
    DateInput: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        value: z.string().nullable(),
        min: z.string().nullable(),
        max: z.string().nullable(),
        checks: d.Input.props.shape.checks,
      }),
      description: "Date picker. Value is YYYY-MM-DD. min/max are YYYY-MM-DD.",
    },
  },
  actions: {
    submit: {
      params: z.object({
        action: z.string().describe("Name the agent sees, e.g. confirm or cancel"),
        values: z.record(z.string(), z.unknown()).nullable().describe("Usually { \"$state\": \"/form\" }"),
        wake: z.boolean().nullable().describe("false only stores the input; default wakes the agent"),
      }),
      description: "Send values to the agent. Posts them as the user's comment, which wakes the agent.",
    },
  },
});
