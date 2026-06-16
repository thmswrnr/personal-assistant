---
name: haushaltsbuch
description: Add expenses to the user's Haushaltsbuch (household budget) Google Sheet. Use when the user wants to log spending — "ich war einkaufen", "trag ins haushaltsbuch ein", "log this expense", reading off a Kassenbon/receipt grouped by category, any "X € for <category>", OR when the user sends/drops a photo or scan of a receipt/invoice (Kassenbon, Rechnung) — read it with vision and log it. Appends rows to the "Variable Ausgaben" tab only.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Haushaltsbuch

The user keeps a yearly household-budget spreadsheet named **`haushaltsbuch<year>`** (e.g.
`haushaltsbuch2026`) with three tabs:

- **Übersicht** — auto-aggregates the entries by day/week. **Never touch it** (it's all formulas).
- **Variable Ausgaben** — the line-item list. **This is the only tab you ever write to.**
- **Kategorien** — the canonical category list: **column A** is the category name (feeds the
  dropdowns), **column B** is a short description of what belongs in it. Read-only reference,
  but **your guide for classifying receipt items**.

You only ever **append rows to `Variable Ausgaben`**. Everything else is the user's to edit by hand.

## Columns (Variable Ausgaben)

| A Datum | B Betrag | C Kategorie | D Notiz (optional) |
|---------|----------|-------------|--------------------|
| `16.06.2026` | `12,45 €` | `Lebensmittel` | `` |

- **Datum** — German format `DD.MM.YYYY`. Default to **today** unless the user gives a date.
- **Betrag** — German currency `12,45 €` (comma decimal, a space, then `€`). The sheet is in
  German locale, so this parses to a real number — match this format exactly.
- **Kategorie** — must match a name from the **Kategorien** tab exactly (it feeds a dropdown).
  Classify **each item on its own** against the **Kategorien** list (**`read` Kategorien `A:B`**,
  use the column-B descriptions). **Don't guess, and don't default a whole receipt to one
  category** — most receipts span several. **When you can't tell what an item is** (cryptic
  receipt abbreviation, unknown brand), do **one** `websearch` to identify it, then classify;
  if it's *still* unclear, **ask the user** — never assign a category you're unsure of. Use
  **`Sonstiges`** only for things that genuinely fit nothing. Don't invent a category.
- **Notiz** — **use it.** By default put the **shop name** here (e.g. `Rewe`, `dm`, `Aldi`).
  Add a short extra detail if the user mentions one (`Rewe — Geburtstagsgeschenk`).

## From a photo or scan (receipt / invoice)

Receipts often arrive as an **image** — sent on the fly via Telegram, or dropped in the inbox
(`process-inbox` will hand it here). The model can read images, so:

1. **Read the image.** Pull out: the **shop name** (header), the **date** (German receipts use
   `DD.MM.YYYY` or `DD.MM.YY` — use the receipt's date, not today, unless it's unreadable), the
   **line items** with their prices, and the printed **total** (Summe/Gesamt).
2. **Classify each item, then sum by category** (read `Kategorien!A:B`). A supermarket receipt
   normally spans **several categories** (food, drinks, household, Drogerie, …) — classify items
   **individually**; **never lump the whole receipt into `Lebensmittel`** just because it's a
   supermarket. If an item is unclear, one `websearch` or ask (see **Kategorie** above) — don't guess.
3. **Reconcile.** Your per-category sums should add up to the receipt's printed total. If they
   don't, something was misread or there's a Pfand/discount/deposit line — say so and check with
   the user rather than forcing it.
4. **Confirm the breakdown, then append** (one row per category, date from the receipt, shop in
   Notiz). OCR from a phone photo can misread digits, so always show the parsed amounts for a
   quick OK before writing.

If an amount or the date is genuinely unreadable, ask — don't guess at money.

**Handling a correction.** If the user says an item belongs to a different category, move **only
that one item**: subtract its amount from its old category's row and add it to the new category's
row — every other item stays put. Then re-show the updated per-category breakdown. **Never collapse
the whole receipt into the corrected category** — a correction touches one item, not the trip.

## Grouping — one row per category, per shopping trip

This is the core rule. A receipt has many items; you do **not** add a row per item. **Group the
trip's items by category and sum the amounts within each category → one row per category.**
Example: 10 items = 5 Lebensmittel + 2 Kleidung + 3 Medikamente ⇒ **3 rows** (the summed
Lebensmittel total, the summed Kleidung total, the summed Medikamente total), all dated that day,
all with that shop's name in Notiz.

**Each trip is independent — always append, never merge with what's already there.** If the user
shops again the same day (even the same shop, same category), that's a **new row**. Never edit,
combine, or overwrite an existing row to fold in a later trip — duplicates of the same
date+category are correct and expected. (The skill is append-only anyway, but the grouping is
*within one trip*, not across the day.)

## How to log a shop

The usual flow: the user has been shopping and reads off the receipt items. Classify each item,
**sum per category**, and append one row per category — all dated today, all with the shop name
in Notiz, in a single call.

```bash
S="node /app/.pi/skills/sheets/sheets.mjs"

# 1. Find this year's book → id (pick the exact-name match, e.g. haushaltsbuch2026)
$S find "haushaltsbuch2026"

# 2. Get the categories + their descriptions, and use them to classify the items.
#    Column A = category name (use it verbatim), column B = what belongs in it.
$S read <id> "Kategorien!A1:B40"

# 3. Append ONE row per category (amounts summed within each), shop name in Notiz (col D):
$S append <id> "Variable Ausgaben!A1" --json '[
  ["16.06.2026","35,12 €","Lebensmittel","Rewe"],
  ["16.06.2026","24,90 €","Kleidung","Rewe"],
  ["16.06.2026","18,40 €","Arzt/Medikamente","Rewe"]
]'
```

## Rules

- **Confirm before writing.** Show the user the rows you're about to add (date, amount,
  category, note) and append only after they're happy — it's their real financial record.
- Append-only, **Variable Ausgaben only**. Never write to Übersicht or Kategorien, and never
  try to edit/delete existing rows (this skill can't, by design — the user does that in Sheets).
- Use the current year's book. Today's year comes from the injected date; build the name
  `haushaltsbuch<year>` and pick the exact-name match from `find`.
- Keep the German formats exact: `DD.MM.YYYY` and `12,45 €`. Don't reformat amounts to dots or
  drop the `€` — that would break the Übersicht sums.
- If credentials are missing/lack the `spreadsheets` scope, the user runs
  `scripts/google-oauth.mjs`. Never invent expenses.
