# Aiosell Channel Manager API — Reference

Source: https://apidocs.aiosell.com/ (extracted from the docs SPA bundle, Sep 2026)

## Connection

- **Base URL:** `https://live.aiosell.com/api/v2/cm`
- **Auth:** `Authorization: Basic <base64(user:pass)>` on every request
- **Sandbox:** `hotelCode=sandbox-pms`, `partnerId=sample-pms`
- `{pms}` in a path = the partner slug Aiosell assigns us
- Integration guide: https://support.aiosell.com/portal/en/kb/articles/aiosell-channel-manager-integration-guide

## Endpoints

### Property details — call this FIRST
`GET /property_details/{hotelCode}?partnerId={pms}`

Returns `hotel_id`, `rooms[]` (`room_id`, `room_name`, `count`, `min_occ`, `max_occ`),
nested `rateplans[]` (`rateplan_id`, `rateplan_name`, `occupancy`, `no_of_meals`, `extra_adult`),
plus `currency`, `timezone`, and `connected_channels[]`.

`connected_channels[]` entries are `{operation, partner_id, hotel_code, rate_multiplier?}`
where `operation` is one of `inventory` | `rates` | `reservation`. The `rates` rows carry
`rate_multiplier` — this is the per-channel multiplier shown in the Channel Manager UI.

The `room_id` / `rateplan_id` values here are the exact codes required by every other call.

### Push (us → Aiosell)
| Method | Path | Purpose |
|---|---|---|
| POST | `/update/{pms}` | Inventory push |
| POST | `/update-rates/{pms}` | Rate push |
| POST | `/update/{pms}` | Inventory restrictions |
| POST | `/update-rates/{pms}` | Rate restrictions |
| POST | `/marknoshow/{pms}` | Mark no-show |

### Fetch (us ← Aiosell)
`POST /data/{pms}` — inventory, rates, and reservations (discriminated by body).

### Reservations (Aiosell → us)
`POST {your_endpoint}` — book / modify / cancel webhooks we host.

### Advanced
`POST /channel_multiplier/{pms}` — property-wide multiplier per channel.

## Payload shapes

Inventory push:
```json
{ "hotelCode": "sandbox-pms",
  "updates": [{ "startDate": "2023-01-24", "endDate": "2023-01-26",
                "rooms": [{ "roomCode": "executive", "available": 5 }] }] }
```

Rate push — grain is (room, rateplan, date); date ranges expand per-day server-side:
```json
{ "hotelCode": "sandbox-pms",
  "updates": [{ "startDate": "2023-02-22", "endDate": "2023-02-24",
                "rates": [{ "roomCode": "executive",
                            "rateplanCode": "executive-s-ep" }] }] }
```

Restrictions (optional `toChannels` targets specific channels):
```json
{ "hotelCode": "sandbox-pms",
  "toChannels": ["agoda", "booking.com"],
  "updates": [{ "startDate": "2023-01-24", "endDate": "2023-01-26",
                "rooms": [{ "roomCode": "executive",
                  "restrictions": { "stopSell": false, "minimumStay": 1,
                    "maximumStay": null, "closeOnArrival": false,
                    "closeOnDeparture": false, "minimumStayArrival": null,
                    "maximumStayArrival": null, "exactStayArrival": null,
                    "minimumAdvanceReservation": null,
                    "maximumAdvanceReservation": null } }] }] }
```

Channel multiplier:
```json
{ "hotelCode": "sandbox-pms", "multiplier": 1.25, "channels": ["gommt", "airbnb"] }
```

## Constraints that shape the UI

1. **The multiplier is property-wide per channel, not per rate plan.** `channel_multiplier`
   takes `{multiplier, channels[]}` with no room or rateplan field, and `property_details`
   returns one `rate_multiplier` per channel. The mock screenshot shows a multiplier on each
   rate-plan row; that granularity is not supported by this API. Either display it as a
   property-level control, or keep per-plan multipliers local and pre-multiply the rates we
   push. Needs a decision before the Channel Manager UI is final.
2. `channels` must be non-empty — an empty array is rejected, it does not mean "all".
3. Multipliers apply on top of pushed rates; they never overwrite them.
4. Channel slugs are Aiosell's (`gommt` = MakeMyTrip/Goibibo, `agoda`, `airbnb`, `google`),
   not the display names.
5. Credentials are Basic auth, so all calls must be server-side only (route handlers),
   never from client components.
