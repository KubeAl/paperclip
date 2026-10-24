### OpenUI panels: forms, choices, cards and charts
`~/infra/paperclip/bin/live-panel ui [--panel P] [--title T] FILE.oui` shows an OpenUI Lang program (library from openui.com, its own look). Use it when you need **charts** or rich choice cards; for a plain form `live-panel spec` fits Paperclip's look better. Bad programs are rejected with the reason; fix and resend.

Rules: one `name = Expression` per line; `root = Stack([...])` first; arguments are **positional** (no `key: value` args; skip optional ones only at the end, use `null` to skip one in the middle); every name except root must be used somewhere, else it is an error. Strings in double quotes. No Query/Mutation, no network: put the data in the program; images must be data: URLs.

When the user clicks a button with `@ToAssistant("action", {extra: 1})`, the panel posts `{field: value, ..., extra: 1}` of its Form as the user's comment (it wakes you); `live-panel input --panel P` returns `{action, values}`. Buttons inside a Form check the rules first (put an always-working Cancel outside the Form). A button without an action sends its label. `@OpenUrl("https://...")` opens a new tab.

```
Stack(children, direction?: "row"|"column", gap?: "s"|"m"|"l", align?, justify?, wrap?: bool)
Card(children, variant?: "card"|"sunk"|"clear")         CardHeader(title?, subtitle?)
TextContent(text, size?: "small"|"default"|"large"|"small-heavy"|"large-heavy")   (markdown ok)
Callout(variant: "info"|"warning"|"error"|"success"|"neutral", title, description)
Tag(text, icon?, size?: "sm"|"md"|"lg", variant?: "neutral"|"info"|"success"|"warning"|"danger")
EntityList(rows?: [{left, right, rightVariant?: "number"}])            key/value rows
Table([Col(label, dataArray, type?: "string"|"number")])               column-oriented
Steps([StepsItem(title, details)])         Tabs([TabItem(value, label, [children])])
BarChart(labels, [Series(name, numbers)], variant?: "grouped"|"stacked", xLabel?, yLabel?)
LineChart / AreaChart(labels, [Series(...)], variant?: "linear"|"natural"|"step", xLabel?, yLabel?)
PieChart(labels, numbers, variant?: "pie"|"donut")      HorizontalBarChart(labels, [Series(...)])
Form(name, Buttons([...]), [FormControl(label, input, hint?)])
Input(name, placeholder?, type?: "text"|"email"|"number"|"url", rules?)     TextArea(name, placeholder?, rows?, rules?)
Select(name, [SelectItem(value, label)], placeholder?, rules?)       DatePicker(name, mode?: "single"|"range", rules?)
RadioGroup(name, [RadioItem(label, description, value)], defaultValue?, rules?)
CheckBoxGroup(name, [CheckBoxItem(label, description, name, defaultChecked?)], rules?)
Chips(name, type?: "single"|"multiple", [ChipItem(value, label)], rules?)
OptionCards(name, type?: "single"|"multiple", [OptionCard(value, title, subtitle?, Icon("lucide-name"))], rules?)
Slider(name, "continuous"|"discrete", min, max, step?, defaultValue?: [n])
Button(label, action?, variant?: "primary"|"secondary"|"tertiary", type?: "normal"|"destructive")
```
rules = `{required: true, min: 1, max: 9, minLength: 2, maxLength: 80, email: true, pattern: "^[A-Z]+$"}`. Icons are lucide names (`circle-check`, `package`, `moon`).

Choice card (never for prod deploy approval: the owner-only card stays):
```
root = Stack([head, form])
head = CardHeader("How should I fix the GST mismatch?", "Sep-26: books ₹7,272 higher than GSTR-2B.")
form = Form("fix", btns, [how, note])
how = FormControl("Fix", OptionCards("how", "single", [entry, vendor, wait], {required: true}))
entry = OptionCard("entry", "Post a set-off entry", "Books match today", Icon("file-plus"))
vendor = OptionCard("vendor", "Ask the vendor", "They amend their return", Icon("mail"))
wait = OptionCard("wait", "Wait for October", "May clear by itself", Icon("clock"))
note = FormControl("Note", TextArea("note", "Optional", 2))
btns = Buttons([go])
go = Button("Go ahead", @ToAssistant("fix", {month: "2026-09"}), "primary")
```
Chart + numbers summary:
```
root = Stack([title, kpis, chart, top])
title = TextContent("Sales, last 6 months", "large-heavy")
kpis = Stack([k1, k2, k3], "row", "m", "stretch", "start", true)
k1 = Card([TextContent("Revenue", "small"), TextContent("₹48.2L", "large-heavy"), Tag("+12%", null, "sm", "success")])
k2 = Card([TextContent("Orders", "small"), TextContent("1,284", "large-heavy"), Tag("+4%", null, "sm", "success")])
k3 = Card([TextContent("Returns", "small"), TextContent("3.1%", "large-heavy"), Tag("+0.6 pt", null, "sm", "warning")])
chart = Card([CardHeader("Revenue by month (₹L)"), BarChart(months, [online, store], "stacked")])
months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]
online = Series("Online", [4.1, 4.6, 5.0, 5.2, 5.9, 6.4])
store = Series("Store", [3.0, 3.2, 3.1, 3.4, 3.6, 3.7])
top = Table([Col("Product", ["Widget", "Gadget", "Gizmo"]), Col("Units", [412, 388, 251], "number")])
```
