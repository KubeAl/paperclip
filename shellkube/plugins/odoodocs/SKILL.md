---
name: odoo-docs
description: Read, edit and create the Odoo files of your Paperclip task (plugin shellkube.odoodocs) with the odoo-docs CLI; also templates, PDF export, share links, file requests and the Odoo Knowledge wiki (markdown pages). Use when a task has linked Odoo files or asks you to write a document there.
---

# odoo-docs

The task's "Odoo files" tab links it to an Odoo `project.task`. You work on that task's files as your own Odoo bot user.

    odoo-docs list [--query Q]                         # files: id, name, version, version_id, locked, editors, author_name
    odoo-docs read FILE_ID --out PATH [--version V]   # download the current (or an old) version
    odoo-docs write FILE_ID PATH --base VERSION_ID --note TEXT
    odoo-docs create NAME [PATH] [--template ID] [--note TEXT]   # no PATH + .docx/.xlsx/.pptx name = blank file
    odoo-docs create NAME.excalidraw --mermaid PATH [--note TEXT]   # a diagram from Mermaid source
    odoo-docs comment FILE_ID TEXT                    # a note in the file's chatter in Odoo
    odoo-docs templates                               # template ids for create --template ({{field}} filled from the task)
    odoo-docs pdf FILE_ID                             # PDF next to the file (or a new version of that PDF)
    odoo-docs share FILE_ID [--expires YYYY-MM-DD] [--password P]   # public link; only when the task asks for one
    odoo-docs request NAME (--user LOGIN | --email EMAIL) [--deadline YYYY-MM-DD] [--note TEXT]   # ask someone to upload a file
    odoo-docs kb-search [--query Q]                   # Knowledge pages: id, name, parent, tags, history_id, locked, pending_approval
    odoo-docs kb-read PAGE_ID --out PATH.md           # a page as markdown
    odoo-docs kb-write PAGE_ID PATH.md --base HISTORY_ID [--section HEADING] --note TEXT   # append, or replace one section
    odoo-docs kb-create NAME PATH.md [--parent PAGE_ID] --note TEXT

Every write makes a new version; nothing is overwritten. Each save posts a short line in the task thread (file, version,
your note, link). Do not post your own "Saved ..." comment; your end-of-run comment only adds what that line does not say.
Exit code 3 = LOCKED or CONFLICT (printed as JSON).

Rules:
- Always pass `--note`: one line that says what you changed.
- `--base` is the `version_id` you read. **CONFLICT** means someone saved after you read: read the new version, apply your
  change to it again, write with the new base. Never write your old copy over it.
- **LOCKED** means a person has the file open in the editor. Stop: do not retry or wait in a loop. Say in your comment
  that the file was locked, set the task to `blocked` and end your run. You are woken on the same task when the file is free.
- Diagrams (`.excalidraw`): `read` also prints `text` (the labels and arrows as "A -> B"); read that, not the JSON.
  To make a new diagram, write Mermaid and use `create --mermaid`; it is drawn when a person opens it. To change a
  diagram, `write` Excalidraw scene JSON with the same `--base` rules. **INVALID** (exit 1) means the editor could not
  open your scene; `reason` says what to fix (e.g. arrows and lines need `points`). Nothing was saved.
- Round-trip only simple files (plain text, .csv, .md, small .docx/.xlsx you generate yourself). Do not rewrite complex
  documents made by people (tracked changes, comments, complex layout): comment instead.

Knowledge (the company wiki; pages are not task files):
- Search before you create; put new pages under the right parent. Link pages as `[label](page:ID)`; `#tag` in the text tags the page.
- Prefer `kb-write` without `--section` (append) or with `--section "Heading"` (replaces that heading and its text up to
  the next heading of the same level; the markdown you write must start with the heading). Never rewrite a whole page
  people wrote: colours, tables with merged cells and layout do not survive markdown.
- `--base` is the `history_id` from `kb-read`; CONFLICT and LOCKED mean the same as for files (exit 3).
- `state: to approve` means the page needs an approver: your change is saved but not live yet. Do not write it again.
