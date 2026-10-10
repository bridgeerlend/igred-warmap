One JSON file per verified incident, named after its event id:

```json
{ "id": "evt_9cc6415c0e8ab8eb", "note": "What was confirmed, in one sentence.", "source": "https://…" }
```

The VERIFY link in a map popup opens GitHub's new-file page with this filled in. Commit it
and the next crisis build draws the incident in magenta with the note.
