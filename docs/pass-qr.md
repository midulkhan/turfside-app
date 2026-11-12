# Entry pass QR (v2)

The QR on a player's ticket carries the ticket itself, signed by the server. The admin
(scanner) app can show the booking the moment it scans, then confirm it with the API.

## Format

```
TSP2.<signature>.<ticket JSON>
```

- `TSP2`: format marker (v1 passes, `tsp1.<bookingId>.<exp>.<sig>`, are still accepted).
- `<signature>`: 22 characters, base64url. The first 22 chars of HMAC-SHA256(PASS_SECRET, ticket JSON).
  Only the server has `PASS_SECRET`, so the app can't verify it. It shows the ticket and
  asks the server.
- `<ticket JSON>`: everything after the second dot, exactly as signed (don't re-serialise it).

## Ticket fields

| key      | example                    | meaning                                    |
|----------|----------------------------|--------------------------------------------|
| `v`      | `2`                        | format version                             |
| `code`   | `"TS-261111-6700"`         | booking code (unique; shown at reception)  |
| `venue`  | `"Mohammadpur Football Hub"` | turf name                                |
| `area`   | `"Mohammadpur"`            | area                                       |
| `pitch`  | `"Main pitch"`             | pitch name                                 |
| `format` | `"5-a-side"`               | game format                                |
| `date`   | `"2026-11-11"`             | play date (Dhaka)                          |
| `from`   | `"07:00"`                  | start, 24 h, Dhaka time                    |
| `to`     | `"08:00"`                  | end, 24 h, Dhaka time                      |
| `name`   | `"Rafi Ahmed"`             | who booked                                 |
| `phone`  | `"017*****907"`            | their number, masked                       |
| `paid`   | `1200`                     | amount paid, whole taka (BDT)              |
| `via`    | `"bKash"`                  | payment method                             |
| `exp`    | `1762900000`               | unix seconds; void after this (end + 6 h)  |

New fields may be added later; ignore keys you don't know. A breaking change gets a new marker (`TSP3`).

## Scanning flow (admin app)

1. Scan, then `readPass(raw)` (see `src/lib/pass.ts`). Show the ticket right away (it may still be fake).
2. `POST /v1/passes/verify { token: raw }` (owner sign-in). Returns `{ ok, booking, ticket }`:
   - `booking.status`: `confirmed` can be checked in, `checked_in` was already used,
     `cancelled`/`expired` should be refused.
   - Errors: `invalid` (bad or expired signature), `forbidden` (another venue's pass).
3. "Confirm check-in": `POST /v1/passes/check-in { token: raw }`. It marks the booking used once.
   A second scan gets `conflict: "This pass was already used."`.

The server always checks the database, so a valid-looking QR for a cancelled booking, or a
screenshot reused after check-in, is refused.
