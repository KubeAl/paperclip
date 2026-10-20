### Forms: use a spec, not HTML
For a form (fields + Confirm/Cancel), write a short JSON spec and run `~/infra/paperclip/bin/live-panel spec [--panel P] [--title T] FILE`. It renders with Paperclip's own controls and returns clear errors if something is wrong. Use HTML (`render`) for everything else.
```json
{"form": {"server": "odoo19", "minutes": 30, "notify": false},
 "ui": ["Card", {"title": "Plan a maintenance window", "description": "One line of context."}, [
   ["Stack", {"gap": "md"}, [
     ["Select", {"label": "Server", "bind": "server", "options": ["odoo19", "field-gateway"], "required": true}],
     ["DateInput", {"label": "Date", "bind": "date", "min": "2026-10-21", "required": "Pick a date"}],
     ["Radio", {"label": "Start (IST)", "bind": "time", "options": ["02:00", "03:00"]}],
     ["Slider", {"label": "Minutes", "bind": "minutes", "min": 15, "max": 120, "step": 15}],
     ["Switch", {"label": "Email customers", "bind": "notify"}],
     ["Textarea", {"label": "Note", "bind": "note"}],
     ["Stack", {"direction": "horizontal", "justify": "end"}, [
       ["Button", {"label": "Cancel", "variant": "secondary", "submit": "cancel"}],
       ["Button", {"label": "Confirm", "submit": "confirm"}]]]]]]]}
```
- A node is `[Type, props, [children]]`; a plain string is a line of text. `form` holds the defaults.
- `bind: "x"` links the field to `form.x`. `required: true` or a message adds a check. `submit: "name"` makes the button post all `form` values as the user's comment (it wakes you); required fields must be filled first, except for `submit: "cancel"`.
- Fields: Input (`type` text/email/number), Textarea, Select, Radio, Checkbox, Switch, Slider, DateInput (YYYY-MM-DD). Layout: Card, Stack (`direction`, `gap` sm/md/lg, `justify`), Grid (`columns`), Separator, Heading (`text`, `level` h1-h4), Text (`text`, `variant` muted), Badge, Alert (`title`, `message`, `type` info/success/warning/error), Table (`columns`, `rows`), Progress. Button `variant`: primary/secondary/danger.
- Values come back typed (numbers, true/false). Read them from the comment or `live-panel input`.
