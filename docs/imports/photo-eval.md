# Photo import: measured accuracy per model

**Not measured yet.** Measuring calls Claude, and the only Anthropic key for this project is
the import function's secret; in the session that built imports there was no way to call it
(no test account and no local key were available). Until it is measured, the function uses:

- first read: `claude-haiku-5-5` ($0.10 / $0.50 per million tokens), low effort
- a second read by `claude-sonnet-5-5` ($2 / $10), medium effort, only when more than 20% of
  the lines come back marked unsure (handwriting, glare, blur)

Both can be changed without a deploy (IMPORT_PHOTO_MODEL, IMPORT_PHOTO_RETRY_MODEL secrets).
Run `scripts/eval-photo-import.ts` (see `test-imports/README.md`) to replace this page with
measured results for Haiku 5.5, Haiku 4.5 and Sonnet 5.5 on every image, then set the
defaults from them.
