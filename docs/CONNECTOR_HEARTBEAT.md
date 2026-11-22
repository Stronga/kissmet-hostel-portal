# Pi connector heartbeat (Worker side implemented locally; migration 0020 NOT applied remotely)

## Decision: D1 migration 0020, last-seen row per connector

| Option | Verdict |
|---|---|
| **D1 table (0020), one upserted row per connector** | **Chosen.** D1 is already bound in every env; strongly consistent, so a conditional upsert gives atomic replay protection; 1 write/heartbeat (~1,440/day at 60 s) is far inside D1 limits; no history growth; the admin read is a single indexed lookup. |
| Workers KV | Rejected: eventually consistent (up to ~60 s) so it cannot enforce "timestamp must increase"; free tier is 1,000 writes/day (a 60 s heartbeat needs 1,440); needs a new binding/namespace in every env. |
| Durable Object | Rejected: strongest semantics but new class, migration tag and binding for one row of state; overkill for one hostel. |
| Store nothing / Analytics only | Rejected: admins need "last seen / stale" in the portal. |

The migration is additive (new table only, `IF NOT EXISTS`), is covered by local sql.js tests and
was applied locally with `wrangler d1 migrations apply DB --local` (temp persist dir). **Remote
apply to staging/production requires approval.** If the Worker is deployed before 0020 is applied,
only `POST /connector/heartbeat` and `GET /admin/internet-access/connector-status` fail (500); all
other routes are unaffected.

## Wire protocol v1

```
POST https://api.kissmetgroup.org/connector/heartbeat
Content-Type: application/json
X-Kissmet-Connector-Id: <lowercase UUID; must be listed in CONNECTOR_HEARTBEAT_ALLOWED_IDS>
X-Kissmet-Timestamp:    <unix seconds, integer>
X-Kissmet-Nonce:        <16-64 chars [A-Za-z0-9_-], random per request>
X-Kissmet-Signature:    v1=<hex HMAC-SHA256(CONNECTOR_HEARTBEAT_SECRET, canonical)>

canonical = "v1\nPOST\n/connector/heartbeat\n" + id + "\n" + ts + "\n" + nonce + "\n" + hex(sha256(raw body bytes))

body (all optional, max 4 KiB):
{"version":"0.1.0","hostname":"kissmet-pi","connectorStatus":"ok|degraded|down|unknown",
 "routerosStatus":"ok|unavailable|unknown","uptimeSeconds":12345}
```

Responses: `200 {"ok":true,"data":{"acceptedAt":...}}`; `401 unauthorized` (bad/missing signature,
unknown id, or clock skew > 300 s — deliberately indistinguishable); `409 replay` (timestamp not
newer than the last accepted one); `400 bad_request`; `413`; `429` (60/min/IP isolate-local brake);
`503 not_configured` (secret < 32 chars or allowlist empty — fail closed).

Rules: send at most one heartbeat per second (timestamps must strictly increase), keep the Pi clock
NTP-synced (chrony/systemd-timesyncd), use a 10 s HTTP timeout, never retry with the same timestamp.

Admin read: `GET /admin/internet-access/connector-status` (`internet:read`) →
`{configured, staleAfterSeconds, connectors:[{connectorId,lastSeenAt,ageSeconds,stale,version,hostname,connectorStatus,routerosStatus,uptimeSeconds,heartbeatCount,firstSeenAt}]}`.
No source IP, nonce or signature material is returned. (Admin UI card not built yet.)

## Reference sender (Python 3 stdlib) for the existing `kissmet-svc` heartbeat

The current Python service on the Pi was not available for review; adapt it to this shape on site.
Secret comes from a root-owned env file (e.g. `/etc/kissmet/heartbeat.env`, 0600, loaded by its
systemd unit via `EnvironmentFile=`), never from the repo.

```python
import hashlib, hmac, json, os, secrets, time, urllib.request

URL = os.environ.get("KISSMET_HEARTBEAT_URL", "https://api.kissmetgroup.org/connector/heartbeat")
CONNECTOR_ID = os.environ["KISSMET_CONNECTOR_ID"].strip().lower()      # persistent UUID
SECRET = os.environ["KISSMET_HEARTBEAT_SECRET"].encode()                 # = Worker CONNECTOR_HEARTBEAT_SECRET

def send(status: dict) -> int:
    body = json.dumps(status, separators=(",", ":")).encode()
    ts = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join(["v1", "POST", "/connector/heartbeat", CONNECTOR_ID, ts, nonce,
                           hashlib.sha256(body).hexdigest()]).encode()
    sig = hmac.new(SECRET, canonical, hashlib.sha256).hexdigest()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Kissmet-Connector-Id": CONNECTOR_ID,
        "X-Kissmet-Timestamp": ts,
        "X-Kissmet-Nonce": nonce,
        "X-Kissmet-Signature": "v1=" + sig,
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

# connectorStatus/routerosStatus: probe http://127.0.0.1:8788/health (no auth) and, if the
# heartbeat service is given the connector Bearer secret, /v1/health.
```
