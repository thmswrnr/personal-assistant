---
name: haushaltsbuch
description: Add expenses to the user's Haushaltsbuch (household budget) Google Sheet. Use when the user wants to log spending — "ich war einkaufen", "trag ins haushaltsbuch ein", "log this expense", reading off a Kassenbon/receipt grouped by category, any "X € for <category>", OR when the user sends/drops a photo or scan of a receipt/invoice (Kassenbon, Rechnung) — read it with vision and log it. Classifies mixed receipts item by item, handles Pfand and discounts, and appends rows to the "Variable Ausgaben" tab only.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Haushaltsbuch

Classify common receipt items correctly **without unnecessary questions**, while still asking
when a line is genuinely ambiguous.

The user keeps a yearly budget spreadsheet in **Google Sheets**, named **`haushaltsbuch<year>`**
(e.g. `haushaltsbuch2026`), with three tabs. You only ever **append rows to `Variable Ausgaben`**
— everything else is read-only.

- **Variable Ausgaben** — the line-item list. The only tab you write to.
- **Kategorien** — the canonical categories: column A is the name, column B describes what belongs in it.
- **Übersicht** — formulas only. Never touch it.

## Row format

| A Datum | B Betrag | C Kategorie | D Notiz |
|---------|----------|-------------|---------|
| `16.06.2026` | `12,45 €` | `Lebensmittel` | `Rewe` |

- **Datum** — `DD.MM.YYYY`. Use the receipt's date when present; otherwise today.
- **Betrag** — `12,45 €`: comma decimal, space, then `€`.
- **Kategorie** — must match a real value from `Kategorien` exactly.
- **Notiz** — usually the merchant name (`Rewe`, `dm`, `Esso`).

## Core flow

1. Find this year's sheet by exact name: `haushaltsbuch<year>`.
2. Read `Kategorien!A1:B40`.
3. Extract from the receipt:
   - merchant
   - date
   - line items
   - printed total
4. Classify **each item** first, then group by category.
5. Reconcile grouped sums to the printed total.
6. Show the proposed rows to the user.
7. Append only after the user approves.

## Grouping

Use **one row per category, per receipt/trip**.

Example:
- 5 Lebensmittel items
- 2 Hygieneartikel
- 1 Rauchen

becomes 3 rows, all with the same date and merchant note.

Never merge across separate receipts, even on the same day.

## Confidence policy

Classify decisively where the evidence is strong; spend a question only where it is not.

### Auto-classify without asking
Auto-classify when:
- the item text clearly names a known product type or brand family
- the merchant context strongly supports the class
- the classification is consistent with the sheet's category descriptions

### Ask only for the specific ambiguous item
Ask a follow-up only when:
- OCR is too poor to reliably read the item or amount
- a branded/abbreviated item could plausibly belong to multiple categories
- the category materially changes the bookkeeping and there is no strong lexical clue

### Do not block the whole receipt
If one item is ambiguous, isolate it. Classify the rest, explain the one uncertain line, and ask
only about that line.

## Classification heuristics

Always read the actual `Kategorien` tab first, then apply these heuristics.

### Lebensmittel
Classify as **Lebensmittel**:
- groceries from supermarkets
- drinks, snacks, bread, dairy, fruit, vegetables
- kiosk/tankstelle food and drinks
- convenience food
- meat snacks like **Beef Jerky** / **Jack Link's**
- beer, soft drinks, tea, water
- mints / lozenges / cough sweets sold as food items like `Fisherman's Friend`
- receipt lines like `KOERN`, `HUETTENK`, `BLATTSALAT`, `CHERRYTOMATE`, `FUZE TEE`, `LIPTON`

### Rauchen
Classify as **Rauchen**:
- tobacco products and brands
- cigarettes, rolling tobacco, cigars/cigarillos, papers, filters
- receipt lines containing or strongly matching brands/terms like:
  - `Pueblo`
  - `Marlboro`
  - `Lucky Strike`
  - `Camel`
  - `Winston`
  - `Chesterfield`
  - `Gauloises`
  - `Pall Mall`
  - `Drum`
  - `Javaanse`
  - `Gizeh`
  - `OCB`
  - `Filter Tips`

**Important:** if a tobacco brand is recognizable, do **not** ask just because the OCR truncates it.

Example:
- `Pueblo Blue PC` → **Rauchen**

### Nahrungsergänzungsmittel
Classify as **Nahrungsergänzungsmittel**:
- magnesium, creatine, protein powder, vitamins, zinc
- common supplement terms like `Whey`, `Creatin`, `Magnesium`, `Zink`, `Vitamin D`

### Kleidung
Classify as **Kleidung**:
- clothing of all kinds, including sports clothing
- shirts, shorts, training tops, running shorts, jackets, trousers

**Important:** sports clothing is still **Kleidung**.
Use **Sportequipment** for gear/equipment, not apparel.

### Büroartikel
Classify as **Büroartikel**:
- stationery and office-like small items
- batteries, especially receipt lines like `AAA`, `Micro AAA`

### Hygieneartikel
Classify as **Hygieneartikel**:
- body/personal care only
- shampoo, soap, deodorant, toothpaste, toilet paper, body care, razors
- hair styling / grooming products like `Haarspray`, `HS`, `Pflege&Halt`, `Extra Stark`

**Important:** Hygieneartikel is for the body/person, not household cleaning.

### Reinigungsartikel
Classify as **Reinigungsartikel**:
- detergent, cleaning sprays, dishwashing products, sponges, trash bags, paper towels
- descaling / machine-cleaning products like `Entkalker`

### Tanken
Classify as **Tanken**:
- fuel lines such as `Diesel`, `Super`, `Super E10`, `Ultimate`, liters of fuel
- never confuse this with kiosk food from a petrol station

### Auswärts Essen/Trinken
Classify as **Auswärts Essen/Trinken**:
- restaurant, café, bar, bakery meal, takeaway meal, prepared hot food where the purchase is
  clearly a meal rather than groceries

### Sonstiges
Use **Sonstiges** only if nothing else fits and there is no better canonical category.

Examples:
- bike maintenance products like `Kettenreiniger`

## Receipt mechanics

### Pfand
Treat deposit lines as part of the same shopping trip total.

- Positive `Pfand` lines increase the total.
- Negative `Leergut` lines decrease the total.
- Do **not** create a separate Pfand category.
- Keep the receipt reconciling to the printed total.

If the receipt is otherwise all beverages/food, keep the Pfand effect within the grouped food total.
If the receipt spans multiple categories, include the deposit effect in the most directly related
beverage/food grouping unless the receipt structure makes a different allocation obvious.

### Discounts / coupons
Discounts reduce the trip total and should be reflected in the grouped category totals. Do not ignore them.
If a discount clearly belongs to a specific product/category, apply it there. If not, distribute it
in the least surprising way that still reconciles.

### Mixed receipts
Mixed receipts are normal. Classify item-by-item, then sum per category. Never force a whole mixed
receipt into one category just because most lines belong there.

## OCR and unknown brands

For cryptic lines:
1. use merchant context
2. use product keywords
3. use brand recognition
4. if still unclear, do one `websearch`
5. if still unclear after that, ask

Do not ask when the evidence is already strong enough.

### OCR interpretation
When OCR is slightly wrong but the intended product is strongly recoverable from context, prefer
the corrected interpretation over a literal but implausible read.

Examples:
- `IS Pflege&Halt` on a supermarket/drugstore receipt may actually be `HS Pflege&Halt`
- `IS Extra Stark` may actually be `HS Extra Stark`

Merchant context helps, but item semantics win.

## Examples

### Example 1 — Esso kiosk receipt
Receipt lines:
- `Bit Pils Dos 0,5` → Lebensmittel
- `DPG Pfand 0.25x1` → part of beverage total, not its own category
- `Pueblo Blue PC` → Rauchen
- `Beef Jerky Origina` → Lebensmittel
- `Beef Jerky Sweet&H` → Lebensmittel
- `Jack Link's BeefBar` → Lebensmittel

Proposed grouped rows:
- `09.08.2026 | 15,45 € | Lebensmittel | Esso`
- `09.08.2026 | 6,75 € | Rauchen | Esso`

Do **not** ask about `Pueblo Blue` if the tobacco brand is recognizable.

### Example 2 — Rewe groceries with Pfand
Receipt lines:
- bread, salad, tomatoes, onions, dairy → Lebensmittel
- `Pfand 0,25` and `Leergut Einweg -1,50` affect the total
- final grouped result may still be a single Lebensmittel row if all purchased items are groceries

### Example 3 — Ask only the narrow question
If one line reads `ABC Active+` and OCR gives no useful clue:
- classify the rest
- ask only: “I can classify everything except `ABC Active+`. What category should that one use?”

## Rules

- **Always show proposed rows before appending.**
- **Never write to anything except `Variable Ausgaben`.**
- **Never invent unreadable amounts, dates, or product meanings.**
- **Prefer decisive classification when evidence is strong.**
- **Ask fewer questions, but ask the right one when needed.**
