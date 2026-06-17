---
name: haushaltsbuch
description: Add expenses to the user's Haushaltsbuch (household budget) Google Sheet. Use when the user wants to log spending — "ich war einkaufen", "trag ins haushaltsbuch ein", "log this expense", reading off a Kassenbon/receipt grouped by category, any "X € for <category>", OR when the user sends/drops a photo or scan of a receipt/invoice (Kassenbon, Rechnung) — read it with vision and log it. Appends rows to the "Variable Ausgaben" tab only.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Haushaltsbuch

The user keeps a yearly budget spreadsheet **`haushaltsbuch<year>`** (e.g. `haushaltsbuch2026`)
with three tabs. You only ever **append rows to `Variable Ausgaben`** — everything else is the
user's to edit by hand.

- **Variable Ausgaben** — the line-item list. The only tab you write to.
- **Kategorien** — the canonical categories: column A is the name (feeds the dropdowns), column B
  describes what belongs in it. Read-only, but your guide for classifying items.
- **Übersicht** — auto-aggregates the entries; all formulas. Never touch it.

## The row

| A Datum | B Betrag | C Kategorie | D Notiz (optional) |
|---------|----------|-------------|--------------------|
| `16.06.2026` | `12,45 €` | `Lebensmittel` | `Rewe` |

- **Datum** — `DD.MM.YYYY`. Default to today unless a date is given (or read off a receipt).
- **Betrag** — `12,45 €`: comma decimal, a space, then `€`. Match exactly — the German-locale sheet
  parses this to a real number; dots or a missing `€` break the Übersicht sums.
- **Kategorie** — must match a **Kategorien** name verbatim (it feeds a dropdown). Classify each
  item on its own (`read Kategorien!A:B`, use the column-B descriptions); don't default a whole
  receipt to one category. Can't tell what an item is (cryptic abbreviation, unknown brand)? Do
  one `websearch`; if it's still unclear, ask — never assign a category you're unsure of, and don't
  invent one. `Sonstiges` is only for things that genuinely fit nothing.
- **Notiz** — the shop name (`Rewe`, `dm`, `Aldi`), plus a detail if the user gives one
  (`Rewe — Geburtstagsgeschenk`).

## Grouping — one row per category, per trip

A receipt has many items but you don't add a row per item: group the trip's items by category and
sum within each → **one row per category**. E.g. 10 items = 5 Lebensmittel + 2 Kleidung +
3 Medikamente ⇒ 3 rows, all dated that day, shop in Notiz.

Each trip is independent: **always append, never merge.** Shopping again the same day — even the
same shop and category — is a new row; duplicates of the same date+category are correct and
expected. (Grouping is within one trip, not across the day; the skill is append-only by design.)

## Logging a trip

Usual flow: the user reads off the receipt. Classify each item, sum per category, confirm the rows,
then append them in a single call.

```bash
S="node /app/.pi/skills/sheets/scripts/sheets.mjs"

# 1. This year's book → id (exact-name match, e.g. haushaltsbuch2026)
$S find "haushaltsbuch2026"

# 2. Categories + descriptions, to classify the items (col A = name, col B = what belongs)
$S read <id> "Kategorien!A1:B40"

# 3. Append one row per category (amounts summed within each), shop in Notiz (col D):
$S append <id> "Variable Ausgaben!A1" --json '[
  ["16.06.2026","35,12 €","Lebensmittel","Rewe"],
  ["16.06.2026","24,90 €","Kleidung","Rewe"],
  ["16.06.2026","18,40 €","Arzt/Medikamente","Rewe"]
]'
```

## From a photo or scan

Receipts often arrive as an image — sent via Telegram or dropped in the inbox (`process-inbox`
hands it here). Read it with vision, then run the same classify → group → append flow, plus:

1. **Pull from the image:** shop name (header), date (use the receipt's `DD.MM.YYYY`/`DD.MM.YY`, not
   today), the line items with prices, and the printed total (Summe/Gesamt).
2. **Reconcile:** your per-category sums should equal the printed total. If they don't, something
   was misread or there's a Pfand/discount line — say so and check, don't force it.
3. **Show the parsed amounts for an OK before writing** — phone-photo OCR misreads digits. If an
   amount or the date is genuinely unreadable, ask; never guess at money.

## Corrections

If the user says an item belongs to a different category, move **only that item**: subtract its
amount from the old category's row and add it to the new one — every other item stays put — then
re-show the breakdown. A correction touches one item, not the whole trip.

## Rules

- **Confirm before writing.** Show the rows (date, amount, category, note) and append only once the
  user is happy — it's their real financial record. Never invent expenses.
- **Append-only, Variable Ausgaben only.** Never write to Übersicht or Kategorien, and never edit
  or delete existing rows (the skill can't, by design — the user does that in Sheets).
- Use the **current year's** book: build `haushaltsbuch<year>` from the injected date and pick the
  exact-name match from `find`.
- If credentials are missing or lack the `spreadsheets` scope, the user runs `scripts/google-oauth.mjs`.
