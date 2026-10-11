# Eksempelrapporter (maler)

To rapporter med plassholdertekst som viser alle byggeklossene i bruk: en halvårsrapport
(`2026-h2.md`) og en analyse (`2026-10-sudan-kordofan.md`). De ligger her, utenfor
`www/content/reports/`, så de ikke publiseres på igred.org.

- Les Markdown-filene for å se hvordan klossene skrives (`::: chart`, `::: map`, `::: figures`,
  `::: table`, `::: risk`, `::: quote`, `::: sources` og fotnoter `[^1]`). I editoren på
  igred.org/admin settes de samme klossene inn med **+** i verktøylinjen.
- `frozen/` er tallene grafene og kartene viste da eksemplene ble bygget.
- Vil du se dem som sider og PDF lokalt:
  `REPORTS_CONTENT=docs/report-examples REPORTS_OUT=/tmp/eksempler npx tsx scripts/build-reports.ts --pdf`
