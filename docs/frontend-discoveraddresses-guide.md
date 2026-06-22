# Frontend Integration Guide — Curated Address Discovery

This guide covers two new pieces of backend infrastructure for the address-discovery flow:

1. **`GET /getPropertyCategories`** — a REST edge function returning the property category / subcategory taxonomy used to build the picker UI.
2. **`discoveraddresses` WebSocket** — a stateful socket that runs an initial discovery, lets the user toggle individual addresses in/out, then commits the curated subset as a `location_zones` row. Three search modes: **count**, **budget**, **polygon**.

This **does not replace** the existing `getAddressesFromZone` REST endpoint or the `findaddresses` socket. Those remain in place for any flows that still use them — this is a parallel surface for the new curation UX.

> **Data source:** this socket queries **RentCast only**. There is no OpenStreetMap fallback. If RentCast returns zero results for the requested area/filter, you'll get a `complete` event with `status: "error"` and code `NO_BUILDINGS_FOUND` — surface that to the user as "no properties found, try broadening the search". (This is intentional — the previous OSM fallback was the source of the multi-second slowness the dev saw.)

---

## TL;DR

```text
[page load]   GET /getPropertyCategories                    → render category picker
[search]      open WS, send { cmd: "search", ... }          → render `progress` + `candidates` events
[curate]      send { cmd: "exclude" | "include", ... }      → receive `curation_update` events
[commit]      send { cmd: "finalize", zone_name? }          → receive `complete` event with `zone_id`
[abort]       send { cmd: "cancel" } or close socket        → nothing is written
```

---

## 1. Endpoints

| Environment | REST base                                          | WebSocket                                                              |
|-------------|----------------------------------------------------|------------------------------------------------------------------------|
| **Dev**     | `https://xnflihspegizweqidvow.supabase.co/functions/v1` | `wss://discoveraddresses-test-331293375800.europe-west1.run.app` |
| **Prod**    | `https://iywivotqnphrjijztxtu.supabase.co/functions/v1` | `wss://discoveraddresses-331293375800.europe-west1.run.app`      |

> **Note:** the prod WebSocket service is not deployed yet — wait for backend's go-ahead before pointing prod traffic at it. Dev is live now.

---

## 2. `GET /getPropertyCategories`

Returns the category / subcategory taxonomy. Static; safe to cache for the user's session.

### Request

```http
GET /functions/v1/getPropertyCategories HTTP/1.1
Authorization: Bearer <supabase_jwt>
apikey: <supabase_anon_key>
```

### Response

```jsonc
{
  "status": "success",
  "data": [
    {
      "id": "residential",
      "label": "Residential",
      "subcategories": [
        { "id": "single_family", "label": "Single Family Home", "rentcast_type": "Single Family" },
        { "id": "condo",         "label": "Condo",              "rentcast_type": "Condo" },
        { "id": "townhouse",     "label": "Townhouse",          "rentcast_type": "Townhouse" },
        { "id": "multi_family",  "label": "Multi-Family",       "rentcast_type": "Multi-Family" },
        { "id": "apartment",     "label": "Apartment",          "rentcast_type": "Apartment" },
        { "id": "manufactured",  "label": "Manufactured",       "rentcast_type": "Manufactured" }
      ]
    },
    {
      "id": "commercial",
      "label": "Commercial",
      "subcategories": [
        { "id": "industrial", "label": "Industrial", "rentcast_type": "Industrial" },
        { "id": "commercial", "label": "Commercial", "rentcast_type": "Commercial" },
        { "id": "retail",     "label": "Retail",     "rentcast_type": "Retail" },
        { "id": "office",     "label": "Office",     "rentcast_type": "Office" }
      ]
    },
    {
      "id": "land",
      "label": "Land",
      "subcategories": [
        { "id": "land", "label": "Land / Lot", "rentcast_type": "Land" }
      ]
    }
  ]
}
```

### Field meaning

- **`id`** — stable category id. Use it as the React `key`, etc.
- **`label`** — display string.
- **`subcategories[*].id`** — this is the value you echo back to the socket as `subcategory_ids`.
- **`subcategories[*].rentcast_type`** — backend-only; you don't need to send it. Useful only if you want to display the raw RentCast type in a tooltip.

### Error responses

| HTTP | Code             | Meaning                            |
|------|------------------|------------------------------------|
| 401  | `UNAUTHORIZED`   | Missing/invalid bearer token       |
| 405  | `METHOD_NOT_ALLOWED` | Only `GET` is supported        |

### Example (fetch)

```ts
async function loadPropertyCategories(jwt: string, anonKey: string) {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/getPropertyCategories`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: anonKey,
      },
    }
  );
  if (!res.ok) throw new Error(`getPropertyCategories: ${res.status}`);
  const body = await res.json();
  return body.data; // array of categories
}
```

---

## 3. `discoveraddresses` WebSocket

A **stateful** socket — unlike `findaddresses`, the server holds the candidate list in memory for the lifetime of the connection so you can curate it before saving.

### 3.1 State machine

```
  connected → search_in_progress → candidates_ready ↔ curating → finalized
                                          ▲ ▼
                                      exclude/include
```

Open the socket → send `search` → receive streamed `progress` events → receive one `candidates` event → toggle addresses via `exclude` / `include` → send `finalize` → receive one `complete` event with the saved `zone_id`.

If the socket dies before `finalize`, **nothing is saved** and the candidate list is lost — you'd need to re-run the search. The candidates payload is small enough that you can locally cache it if you want disconnect-resilience.

### 3.2 Connecting

Standard WebSocket — no auth on the upgrade handshake. Auth is checked when you send the first `search` message via the `headers.authorization` / `headers.apikey` fields on the payload.

```ts
const ws = new WebSocket(WSS_URL);
ws.onopen = () => ws.send(JSON.stringify(searchPayload));
ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
ws.onerror = (e) => console.error(e);
ws.onclose = () => { /* clean up local state */ };
```

### 3.3 Client → Server messages

All messages are JSON strings sent via `ws.send(JSON.stringify(...))`.

---

#### `cmd: "search"` — start initial discovery

One of three modes. The mode is set by `data.mode`.

##### Count mode

Pick a center + a target count. Server expands the search radius until it has `count` results (or hits the 500-address hard cap).

```jsonc
{
  "cmd": "search",
  "address": "Austin, TX",        // string parseAddress can geocode — "lat,lng" OR free text address
  "data": {
    "mode": "count",
    "count": 100,                  // capped at 500
    "subcategory_ids": ["single_family", "condo"],   // OPTIONAL — omit to mean "all subcategories"
    "radius_hint": 5000            // OPTIONAL meters; if absent, server expands until count is met
  },
  "headers": {
    "authorization": "Bearer <jwt>",
    "apikey": "<supabase_anon_key>"
  },
  "campaign_id": "<uuid>"          // OPTIONAL — tags the saved zone with this campaign
}
```

##### Budget mode

Server computes `count = floor(budget_usd / 3)` because each postcard costs $3, then runs the same expand-until-count flow.

```jsonc
{
  "cmd": "search",
  "address": "Austin, TX",
  "data": {
    "mode": "budget",
    "budget_usd": 300,             // → count = 100
    "subcategory_ids": ["single_family"]
  },
  "headers": { ... },
  "campaign_id": "<uuid>"
}
```

##### Polygon mode

User draws an arbitrary polygon on the map; server returns every property inside it. **No `address` / center is needed** — the centroid is derived from the polygon for telemetry only.

```jsonc
{
  "cmd": "search",
  "data": {
    "mode": "polygon",
    "polygon": [                   // closed ring; first/last point need not be equal
      { "lat": 30.2700, "lng": -97.7500 },
      { "lat": 30.2700, "lng": -97.7400 },
      { "lat": 30.2600, "lng": -97.7400 },
      { "lat": 30.2600, "lng": -97.7500 }
    ],
    "subcategory_ids": ["single_family", "townhouse"]
  },
  "headers": { ... },
  "campaign_id": "<uuid>"
}
```

Under the hood: RentCast doesn't support polygons natively (only lat/lng/radius), so the server fetches the polygon's bounding circle and then runs a JS ray-casting point-in-polygon filter. OSM fallback uses Overpass's native `poly:` filter. As a frontend you don't need to care — just send the polygon.

##### Backwards-compat alias

`cmd: "getAddressesFromZone"` is accepted as an alias for `cmd: "search"`. New code should use `"search"`.

---

#### Curation commands — after the `candidates` event

All four curation commands work on a **stable per-address id** (`address_id`) that the server assigns and returns in the `candidates` event. Echo that id back verbatim.

```jsonc
{ "cmd": "exclude",      "address_id": "rc_abc123" }
{ "cmd": "include",      "address_id": "rc_abc123" }
{ "cmd": "exclude_many", "address_ids": ["rc_abc123", "rc_def456"] }
{ "cmd": "include_many", "address_ids": ["rc_abc123"] }
```

- Initial state: every candidate is **included** by default. `exclude` flips it off.
- Idempotent: excluding an already-excluded id is a no-op (no error).
- ID format is informational only — currently `rc_<index>` for RentCast results, `osm_<way_id>` for OSM fallback. Don't parse it; just round-trip it.

---

#### `cmd: "finalize"` — commit the curated zone

```jsonc
{
  "cmd": "finalize",
  "zone_name": "Austin Downtown — Single Family"   // OPTIONAL; server derives a name if omitted
}
```

After receiving `finalize`, the server writes the included subset to `location_zones`, unlinks prior zones from the campaign (if `campaign_id` was provided on the search), and emits one `complete` event with the new `zone_id`. The socket then closes cleanly.

---

#### `cmd: "cancel"` — abort, drop state, no zone saved

```jsonc
{ "cmd": "cancel" }
```

Equivalent to just closing the socket from your side, but explicit. Server confirms with a close.

---

### 3.4 Server → Client events

All events are JSON. Discriminate on the `type` field.

#### `progress` — streamed during the initial search

Same shape as `findaddresses`. Use it to drive a loading UI.

```jsonc
{ "type": "progress", "message": "Querying RentCast properties...", "percent": 40 }
```

#### `candidates` — emitted once when the initial search completes

The full candidate list. Render each address on the map; default `included: true`.

```jsonc
{
  "type": "candidates",
  "mode": "count",                              // echo of data.mode
  "total": 100,                                  // post-cap count
  "center": { "lat": 30.27, "lng": -97.75 },     // search center (centroid for polygon mode)
  "candidates": [
    {
      "id": "rc_0",                              // ← echo this back as address_id
      "address": "123 Main St, Austin, TX 78701",
      "lat": 30.2701,
      "long": -97.7501,
      "propertyType": "Single Family",            // matches a subcategory.rentcast_type
      "included": true                            // initial selection state
    },
    // ...
  ]
}
```

#### `curation_update` — emitted after every `exclude` / `include`

Fires once per address id touched (so `*_many` produces N updates). Use it to keep your local selection state in sync.

```jsonc
{
  "type": "curation_update",
  "address_id": "rc_0",
  "included": false,
  "selected_count": 99       // total currently-included after this change
}
```

#### `complete` — emitted once after `finalize` succeeds

```jsonc
{
  "type": "complete",
  "status": "success",
  "zone_id": "<uuid>",        // freshly created location_zones row
  "saved_count": 78,          // addresses written to the zone
  "excluded_count": 22        // addresses the user excluded
}
```

After `complete`, the socket closes. Your stored candidates payload can be discarded.

#### `error` — any failure

```jsonc
{ "type": "error", "message": "Unable to geocode address" }
```

Common causes: invalid JWT, geocoding failure, RentCast quota exhausted, polygon with fewer than 3 vertices, DB write failure.

#### `complete` with `status: "error"` — RentCast returned zero matches

Distinct from a generic `error` — this is RentCast specifically having no properties to return:

```jsonc
{
  "type": "complete",
  "status": "error",
  "error": "NO_BUILDINGS_FOUND",
  "message": "No properties found in the specified area. Adjust your radius / polygon / category filter."
}
```

Surface this to the user with a "try broadening your filter / area" message — it doesn't mean the system failed, just that RentCast has no coverage there for the requested subcategories.

---

## 4. Suggested frontend flow

```ts
// 1. On the discovery page mounting
const categories = await loadPropertyCategories(jwt, anonKey);
renderCategoryPicker(categories);

// 2. User fills the form. Pick exactly one mode.
const payload = {
  cmd: "search",
  address: "Austin, TX",
  data: {
    mode: "count",
    count: 100,
    subcategory_ids: ["single_family", "condo"],
  },
  headers: { authorization: `Bearer ${jwt}`, apikey: anonKey },
  campaign_id: campaignId,
};

// 3. Open socket, send search
const ws = new WebSocket(WSS_URL);
ws.onopen = () => ws.send(JSON.stringify(payload));

let candidates = [];
const excluded = new Set();

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  switch (msg.type) {
    case "progress":
      setLoadingMessage(msg.message, msg.percent);
      break;
    case "candidates":
      candidates = msg.candidates;
      renderAddressesOnMap(candidates);
      break;
    case "curation_update":
      if (msg.included) excluded.delete(msg.address_id);
      else excluded.add(msg.address_id);
      setSelectedCount(msg.selected_count);
      break;
    case "complete":
      showSuccessToast(`Saved ${msg.saved_count} addresses`);
      navigate(`/zones/${msg.zone_id}`);
      break;
    case "error":
      showErrorToast(msg.message);
      break;
  }
};

// 4. User clicks an address on the map to exclude it
function onAddressToggled(addressId, nextIncluded) {
  ws.send(JSON.stringify({
    cmd: nextIncluded ? "include" : "exclude",
    address_id: addressId,
  }));
}

// 5. User clicks "Save Zone"
function onSaveZone(name) {
  ws.send(JSON.stringify({ cmd: "finalize", zone_name: name }));
}

// 6. User clicks Cancel
function onCancel() {
  ws.send(JSON.stringify({ cmd: "cancel" }));
}
```

### Polygon mode specifics

For polygon mode the `address` field is omitted entirely. The polygon should be at least **3 vertices** (server rejects fewer) and the order should be either clockwise or counter-clockwise — both work since the ray-casting algorithm is direction-agnostic. The first and last point don't need to be equal; the server closes the ring on its end.

### Budget mode specifics

`budget_usd` is in **whole dollars** (US$). Server uses `floor(budget_usd / 3)` to derive `count`. So `$100` → 33 addresses, `$300` → 100. The 500-address cap still applies — `$10,000` → 500, not 3,333.

---

## 5. Removing addresses **after** the zone is saved

Sometimes the user wants to skip a few addresses on a zone they saved yesterday — i.e. after the socket is long-since closed. There's already a REST path for this; no new endpoint needed.

### Mechanism

Each row in `location_zones.addresses[]` supports an `is_deleted: boolean` flag. Both `postcardsendingsocket` and `addressverification` skip any address with `is_deleted === true`. The address stays in the zone for audit/history but is invisible to downstream consumers.

### Flow

```ts
// 1. Fetch the zone
const { zone } = await fetch(
  `${SUPABASE_URL}/functions/v1/getAddressZoneById?id=${zoneId}`,
  { headers: authHeaders }
).then(r => r.json());

// 2. Mutate the address you want to skip
const mutated = zone.addresses.map(a =>
  a.id === targetAddressId ? { ...a, is_deleted: true } : a
);

// 3. PATCH the zone with the mutated array
await fetch(`${SUPABASE_URL}/functions/v1/updateAddressZoneById`, {
  method: "PATCH",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ id: zoneId, addresses: mutated }),
});
```

To **un-skip**, set `is_deleted: false` and PATCH again.

### When to use which path

| Scenario                                                       | Use                                       |
|----------------------------------------------------------------|-------------------------------------------|
| User just ran discovery, hasn't clicked Save yet               | Socket `exclude` / `include`              |
| User saved a zone earlier; wants to skip a few before sending  | `is_deleted` flag + `updateAddressZoneById` |
| User wants to permanently delete the entire zone               | `DELETE /deleteAddressZone`               |

---

## 6. Error handling checklist

- **`type: "error"` from the socket** — show a toast, keep the socket open if the error is recoverable (e.g. validation), close it if it's terminal (auth failure).
- **Socket closes unexpectedly mid-curation** — local candidate state is dead on the server side; either prompt the user to re-run the search, or replay the search payload automatically.
- **REST 401 on `getPropertyCategories`** — JWT expired; trigger your normal token-refresh flow and retry.
- **Empty `candidates` array** — search succeeded but found nothing matching the filters. Show "No addresses found — try broadening your search."
- **`selected_count: 0` at finalize** — backend will reject the finalize (can't save an empty zone). Disable the Save button when `selected_count === 0` on the frontend.

---

## 7. Reference

- **OpenAPI spec**: see the `Discovery Sockets` and `Address Discovery` tags at the public docs URL (the FE OpenAPI client picks both up automatically once it's re-synced).
- **Backend source**:
  - REST: `supabase/functions/getPropertyCategories/index.ts`
  - Dev WS: `supabase/functions/WebSocket/discoveraddresses-test/index.js`
  - Prod WS: `supabase/functions/WebSocket/discoveraddresses/index.js`

If anything is ambiguous or you hit unexpected behavior, ping backend with the WebSocket close-code (if any) and a sample payload.
