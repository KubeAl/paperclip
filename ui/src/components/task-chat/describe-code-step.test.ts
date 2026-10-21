import { describe, expect, it } from "vitest";
import { describeCodeStep } from "./describe-code-step";

describe("describeCodeStep", () => {
  it.each([
    ['r = await bash(f"""timeout 600 ~/infra/paperclip/bin/odoo-run smiv19 --write {f}""")', "Applying a change in Odoo", "smiv19"],
    ['bash("odoo-run baatuli --try fix.py")', "Testing a change in Odoo (rolled back)", "baatuli"],
    ['pc("POST", f"/issues/{T}/comments", {"body": msg})', "Posting a reply", undefined],
    ['await edit.run("/a/b/AGENTS.md", old, new)', "Editing files", "AGENTS.md"],
    ["s1 = r'''\nu = env['res.users'].search([])\n'''", "Preparing an Odoo script", "res.users"],
  ])("%s", (code, running, target) => {
    const step = describeCodeStep(code);
    expect(step?.running).toBe(running);
    expect(step?.target).toBe(target);
  });

  it("returns null when nothing is recognised", () => {
    expect(describeCodeStep("def slug(s): return s.lower()")).toBeNull();
  });
});
