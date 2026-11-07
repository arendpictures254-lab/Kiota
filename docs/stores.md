# Stores and inventory

Stores, the kitchen, uniforms and stock-takes for a boarding school. Code: `src/lib/stores/`
(pure maths in `stock.ts`), screens under `/dashboard/stores`.

## Stores and items

- Every school starts with **Food store**, **Uniform store**, **General store** and
  **Stationery** (Stores → Setup adds more). A store's kind decides which screens apply: meals
  use food stores, uniform issues use uniform stores.
- Items have a **base unit** (kg, litre, piece, packet…), a shelf or category (for the stock-take
  list), a **reorder level**, and optionally a **pack**: a 90 kg bag of maize is received as
  "2 bags" and issued in kg; a 20 litre jerrycan of oil is issued in litres. Perishables can
  record an **expiry date** on each delivery.
- Uniform items are one row per size, with a price.
- Suppliers: name, phone and KRA PIN (optional). No purchase orders yet.

## The stock ledger

Every change of stock is a row in `stock_movements`, which is **append-only** (like money:
no update or delete, enforced by a trigger and grants). Quantities are whole numbers in
thousandths of the base unit (150 g of a kg item is `150`), values are integer cents. **Stock on
hand and its value are always the sums of the movements**; nothing is typed in.

| Movement        | Quantity | Value                                       |
| --------------- | -------- | ------------------------------------------- |
| Received        | +        | what it cost (the delivery note)            |
| Issued, meal    | −        | weighted average cost at that moment        |
| Transfer out/in | − / +    | the same value moves to the other store     |
| Adjustment      | − / +    | average cost (needs a reason, audited)      |
| Stock-take      | − / +    | posted only when the stock-take is approved |
| Uniform issue   | −        | average cost (and a fee charge, below)      |
| Uniform return  | +        | the value it left with                      |

Each movement takes a per-item lock, so two issues at the same moment can never both take the
last bag. An issue larger than what is on the records is refused.

## Why weighted average cost

Stock is valued at **weighted average cost**: the value on hand divided by the quantity on hand,
recalculated with every delivery. Taking 10 kg out of 270 kg worth KES 14,400 takes
10/270 of KES 14,400.

- **It matches the stuff.** Maize from two deliveries is poured into the same bin; nobody can
  say which bag a kilo came from. FIFO (first in, first out) or "specific" costing pretends to
  know.
- **Prices move steadily.** Food prices in Kenya rise through the year; an average smooths a
  cheap and a dear delivery into one honest cost per meal, so the cost-per-student trend shows
  real changes in usage, not which delivery the cook happened to open.
- **Simple to check.** The value on hand is always the sum of the movements, and any issue can be
  re-worked by hand from the two numbers before it. Auditors and the Bursar can follow it.
- **Kenyan practice.** Weighted average is accepted under IFRS (IAS 2) and is what most school
  bursaries already use for food stores.

Taking everything that is left takes all the value, so no shillings are stranded by rounding
(integer maths throughout).

Expiry ("expiring soon") assumes the oldest delivery is used first: the stock on hand is matched
against the newest deliveries, and anything on hand from a delivery expiring within 14 days is
listed.

## Kitchen and meals

- Meals are configuration: **Breakfast, Lunch, Supper** by default; add "10 o'clock tea" in
  Setup.
- The **ration scale** is how much one student gets of each item at each meal (Lunch: maize
  flour 150 g, beans 80 g, cooking oil 10 ml…). The school edits it.
- **Issuing for a meal** (storekeeper): pick the meal; the students served are pre-filled with
  today's boarders in school (boarders less those out on a leave-out). Kiota suggests each
  quantity from the ration scale; the storekeeper records what was actually issued.
- **Variance:** if any line differs from the ration scale by more than the school's percentage
  (10% by default, Setup), the issue is flagged and the Director and Principal get an in-app
  message with the amounts. They mark it reviewed with a note. This is how waste or theft shows.
- **Cost** per meal, per student per day (each day's cost over that day's students) and per
  week, with trends, in Stores → Reports.
- The **cook** (role Cook, `kitchen.confirm`) sees today's issues and confirms the number
  served. The database refuses anything else: no stock movement, and only the "served" columns of
  a meal issue can change.

## Uniforms

- Find the student by admission number: the screen shows everything already issued. Issuing the
  same garment again (any size) is refused unless "Issue again" is ticked.
- Each issue is charged to the student's fee account automatically, through the fees module's
  own charge function (`postCharge`: an append-only charge on the **Uniform** vote head, which
  can be changed in Setup), or marked **paid separately** with a reference.
- A **return** brings the stock back and reverses the charge through the fees module
  (`reverseCharge`: a reversal entry pointing at the charge, never an edit). An **exchange**
  (wrong size) is a return plus a new issue of the other size, in one transaction.
- The charge appears on the student's fee statement and in the parent portal (Fees → Other
  charges).

## Stock-takes

1. The storekeeper starts a stock-take for a store and counts on a phone or tablet (items grouped
   by shelf, a number box each). Counts can be saved and continued.
2. Submit: Kiota records what the books said and values each difference at average cost.
3. The Director or Principal (`stores.stocktake.approve`) approves, which posts one adjustment
   per difference with the stock-take as the reason, or rejects. **Nothing changes until
   approved.**

## Alerts and reports

- **Low stock** (at or below the reorder level) and **expiring soon** (14 days) show on the
  storekeeper's and Director's dashboards, and in a daily in-app digest ("Stores today") made by a
  background job at 07:00 Nairobi time on school days (once per school, even with several
  servers). No SMS for these.
- Reports (Director, Principal, Bursar: `stores.reports`): stock on hand and value per store,
  movements by date range, consumption per item, cost per meal and per student with the weekly
  trend, variance history, uniform issues and charges, stock-take differences, all exportable to
  Excel.
- The Director's dashboard shows stock value, items below reorder level, this week's food cost
  per student and open variance flags.

## Permissions

| Permission                 | Who (built-in)                   |
| -------------------------- | -------------------------------- |
| `stores.view`              | Storekeeper, Principal, Director |
| `stores.receive`           | Storekeeper                      |
| `stores.issue`             | Storekeeper                      |
| `stores.adjust`            | Storekeeper (needs a reason)     |
| `stores.setup`             | Storekeeper, Director            |
| `stores.reports`           | Director, Principal, Bursar      |
| `stores.stocktake.approve` | Director, Principal              |
| `kitchen.confirm`          | Cook                             |

The storekeeper also has `students.view` (uniforms go to a named student).

## Try it

`npm run db:seed` gives Bahari a food store with Kenyan items, three weeks of meals (two flagged),
deliveries from two suppliers, a uniform store with issues charged to students, cooking oil
below its reorder level and an approved stock-take with a difference.

- Omar Hassan, Storekeeper: 0711 000 011
- Esther Achieng, Cook: 0711 000 012
- Amina Said, Director: 0711 000 001 (dashboard widget, variances, approvals, reports)
- Wanjiku Kamau, parent: 0744 000 001 → Brian → Fees: his uniform charges under "Other charges"
