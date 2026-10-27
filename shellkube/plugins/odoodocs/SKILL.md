---
name: odoo-docs
description: Read, edit and create the Odoo files of your Paperclip task (plugin shellkube.odoodocs) with the odoo-docs CLI. Use when a task has linked Odoo files or asks you to write a document there.
---

# odoo-docs

The task's Files tab links it to an Odoo `project.task`. You work on that task's files as your own Odoo bot user.

    odoo-docs list [--query Q]                         # files: id, name, version_id, locked, editors
    odoo-docs read FILE_ID --out PATH [--version V]   # download the current (or an old) version
    odoo-docs write FILE_ID PATH --base VERSION_ID [--note TEXT]
    odoo-docs create NAME [PATH] [--note TEXT]        # no PATH + .docx/.xlsx/.pptx name = blank file
    odoo-docs comment FILE_ID TEXT                    # a note in the file's chatter

Every write makes a new version; nothing is overwritten. Exit code 3 = LOCKED or CONFLICT (printed as JSON).

Rules:
- `--base` is the `version_id` you read. **CONFLICT** means someone saved after you read: read the new version, apply your
  change to it again, write with the new base. Never write your old copy over it.
- **LOCKED** means a person has the file open in the editor. Do not wait in a loop. Post your change as
  `odoo-docs comment`, or finish your run and say in your task comment that the file was locked.
- Round-trip only simple files (plain text, .csv, .md, small .docx/.xlsx you generate yourself). Do not rewrite complex
  documents made by people (tracked changes, comments, complex layout): comment instead.
