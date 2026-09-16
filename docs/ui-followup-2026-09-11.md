# UI continuation review

Recovered main source at b122d84630cc0458cbedf568a14f4eb4a73f581c. That revision already contains a shared UI cleanup and a documented desktop/phone review in ui-review-2026-09-11.md. Earlier conversational statements that no visual review existed were outdated.

## Additional corrections

- Prevent the sidebar brand and footer from shrinking when navigation folders expand. Long submenu labels wrap instead of being truncated.
- Extend readable button sizing and normal spacing to marketing and procurement controls, which do not use the shared action classes.
- Enlarge marketing template copy, metadata, calendar labels, composer options, and form guidance. Keep template cards flexible as text grows.
- Replace the marketing and accounting hero backgrounds with Mefford charcoal; use red accents and neutral template buttons.
- Let heading actions and journal toolbars wrap. Increase ledger tab labels and keep journal/trial-balance columns inside their own horizontal scroll regions.
- Give marketing/procurement dialogs consistent stacking and bounded scrolling; collapse the marketing composer sidebar at narrower widths.

## Verification and limits

Browser review used the managed local preview and an isolated SQLite database with repository migrations and a local review owner. No production records were edited. Independently inspected dashboard, expanded navigation, social templates and content studio, general ledger, trial balance, and new journal entry dialog at the available 1363px desktop viewport. Marketing dialog measured 830px client/scroll width with no horizontal overflow; ledger page width matched the viewport, and sidebar brand retained its 70px height after expansion.

This follow-up does not claim a fresh phone-device review or exhaustive populated-record visual coverage. The prior revision's broader desktop/phone report remains separately identified. Changes affect screen CSS only; printed documents, accounting logic, approval rules, integrations, and Pilot are unchanged.

Required release verification: TypeScript, static checks (existing warnings), production build/artifact validation, 688 passing behavioral tests, coverage thresholds, and 7/7 critical-control mutations. Final output is rebuilt after the last CSS edit before saving.
