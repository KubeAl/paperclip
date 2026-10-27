---
name: odoo-docs
description: Read, edit and create the Odoo files of your Paperclip task (plugin shellkube.odoodocs) with the odoo-docs CLI; also templates, PDF export, share links and file requests. Use when a task has linked Odoo files or asks you to write a document there.
---

# odoo-docs

The task's "Odoo files" tab links it to an Odoo `project.task`. You work on that task's files as your own Odoo bot user.

    odoo-docs list [--query Q]                         # files: id, name, version, version_id, locked, editors, author_name
    odoo-docs read FILE_ID --out PATH [--version V]   # download the current (or an old) version
    odoo-docs write FILE_ID PATH --base VERSION_ID --note TEXT
    odoo-docs create NAME [PATH] [--template ID] [--note TEXT]   # no PATH + .docx/.xlsx/.pptx name = blank file
    odoo-docs comment FILE_ID TEXT                    # a note in the file's chatter in Odoo
    odoo-docs templates                               # template ids for create --template ({{field}} filled from the task)
    odoo-docs pdf FILE_ID                             # PDF next to the file (or a new version of that PDF)
    odoo-docs share FILE_ID [--expires YYYY-MM-DD] [--password P]   # public link; only when the task asks for one
    odoo-docs request NAME (--user LOGIN | --email EMAIL) [--deadline YYYY-MM-DD] [--note TEXT]   # ask someone to upload a file

Every write makes a new version; nothing is overwritten. Your saves show as a short line in the task thread.
Exit code 3 = LOCKED or CONFLICT (printed as JSON).

Rules:
- Always pass `--note`: one line that says what you changed.
- `--base` is the `version_id` you read. **CONFLICT** means someone saved after you read: read the new version, apply your
  change to it again, write with the new base. Never write your old copy over it.
- **LOCKED** means a person has the file open in the editor. Stop: do not retry or wait in a loop. End your run and say in
  your comment that the file was locked. You are woken on the same task when the file is free.
- Round-trip only simple files (plain text, .csv, .md, small .docx/.xlsx you generate yourself). Do not rewrite complex
  documents made by people (tracked changes, comments, complex layout): comment instead.
