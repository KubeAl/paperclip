// Short form for live panel specs: a nested tree the plugin expands into a json-render spec.
//   { "form": { ...defaults }, "ui": NODE }
//   NODE = [Type, props?, [NODE...]?] or a string (a Text line)
// Extra props: bind: "field" (two-way bind to /form/field, also sets name), required: true | "message",
// submit: "action" (Button: sends /form to the agent as that action).
import type { Spec, UIElement } from "@json-render/core";

type Node = string | [string, ...unknown[]];
const CHECKED = new Set(["Checkbox", "Switch"]);

export function isShort(v: unknown): v is { form?: Record<string, unknown>; ui: Node } {
  return typeof v === "object" && v !== null && "ui" in v;
}

export function expandShort(short: { form?: Record<string, unknown>; ui: Node }): Spec {
  const elements: Record<string, UIElement> = {};
  const used = new Map<string, number>();
  const keyFor = (base: string) => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const walk = (node: Node): string => {
    if (typeof node === "string") node = ["Text", { text: node }];
    if (!Array.isArray(node) || typeof node[0] !== "string") throw new Error(`ui node must be [Type, props?, children?] or a string: ${JSON.stringify(node).slice(0, 80)}`);
    const [type, ...rest] = node;
    const props = { ...((rest.find((x) => x && typeof x === "object" && !Array.isArray(x)) ?? {}) as Record<string, unknown>) };
    const kids = (rest.find(Array.isArray) ?? []) as Node[];
    const { bind, required, submit } = props as { bind?: string; required?: boolean | string; submit?: string };
    delete props.bind; delete props.required; delete props.submit;
    const el: UIElement = { type, props, children: [] };
    if (bind) {
      props[CHECKED.has(type) ? "checked" : "value"] = { $bindState: `/form/${bind}` };
      props.name ??= bind;
    }
    if (required) {
      const message = typeof required === "string" ? required : "Required";
      props.checks = [...((props.checks as unknown[]) ?? []), { type: "required", message }];
    }
    if (submit) el.on = { press: { action: "submit", params: { action: submit, values: { $state: "/form" } } } };
    const key = keyFor(bind ?? submit ?? type.toLowerCase());
    elements[key] = el;
    el.children = kids.map(walk);
    return key;
  };
  const root = walk(short.ui);
  return { root, elements, state: { form: short.form ?? {} } } as Spec;
}
