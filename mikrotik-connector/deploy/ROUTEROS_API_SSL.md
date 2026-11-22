# RouterOS api-ssl (8729) for the connector — router-side steps (DOCUMENTATION ONLY)

Nothing here has been run. These are **live router changes** and need the owner's explicit approval,
a fresh `/export` + binary backup first, and an on-site person in case of lock-out. Keep the router's
8728 service available (restricted to the Pi) until 8729 is validated from the Pi — but note the
connector itself will **not** use 8728 in production (see below).

Connector side (already implemented, mock-tested): `MIKROTIK_API_TLS=true`, port defaults to 8729,
`MIKROTIK_API_TLS_CA_FILE` required (chain always verified, TLS >= 1.2), optional
`MIKROTIK_API_TLS_FINGERPRINT256` pin, optional `MIKROTIK_API_TLS_SERVERNAME`.
`MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY` is refused in production. 8728 + TLS is refused.

**Production requires TLS.** With `CONNECTOR_MODE` *or* `NODE_ENV` set to `production`/`prod` and the real
driver, the connector refuses to start unless `MIKROTIK_API_TLS=true`, `MIKROTIK_API_TLS_CA_FILE` is an
absolute path, and certificate verification is on (`MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY` refused).
Plaintext 8728 is only accepted when the environment is *explicitly* non-production (`CONNECTOR_MODE=local`
or `NODE_ENV=development`/`test`); with neither variable set, plaintext is also refused.

## 1. Certificates on the router (RouterOS 7)

```
/certificate add name=kissmet-api-ca common-name=kissmet-api-ca key-usage=key-cert-sign,crl-sign days-valid=3650
/certificate sign kissmet-api-ca
/certificate add name=kissmet-api common-name=192.168.88.1 subject-alt-name=IP:192.168.88.1 key-usage=digital-signature,key-encipherment,tls-server days-valid=825
/certificate sign kissmet-api ca=kissmet-api-ca
/certificate export-certificate kissmet-api-ca type=pem      # exports the CA cert ONLY (no key)
```

Download `cert_export_kissmet-api-ca.crt` (Files) and copy it to the Pi as
`/etc/kissmet/routeros-ca.pem` (`root:<service-group> 0640`). It is public; never export the CA key.

Optional pin: on the Pi, after enabling api-ssl,
`openssl s_client -connect 192.168.88.1:8729 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256`
→ `MIKROTIK_API_TLS_FINGERPRINT256`. (Re-pin whenever the router certificate is re-issued.)

## 2. Enable api-ssl, restricted to the Pi

```
/ip service set api-ssl certificate=kissmet-api tls-version=only-1.2 address=<PI_LAN_IP>/32 disabled=no
/user set portal-api address=<PI_LAN_IP>/32        # keep 192.168.216.5/32 only if dev access is still wanted
```

## 3. Validate from the Pi (read-only)

```
nc -vz 192.168.88.1 8729
# connector with MIKROTIK_API_TLS=true, then (loopback):
curl -s -H "Authorization: Bearer $CONNECTOR_SECRET" http://127.0.0.1:8788/v1/health
```

## 4. Only after 8729 is validated **[APPROVAL]**

```
/ip service set api disabled=yes          # plain 8728 off
/ip firewall filter add chain=input protocol=tcp dst-port=8728,8729 src-address=!<PI_LAN_IP> action=drop comment="kissmet: API only from Pi" place-before=0
```

Never expose 8728/8729 on the WAN/Starlink side. Leave the `default` HotSpot profile untouched.

## Rollback

Router: `/ip service set api disabled=no address=<PI_LAN_IP>/32` restores plain 8728 for other tools.

Connector: there is **no plaintext fallback in production** — `MIKROTIK_API_TLS=false` with
`CONNECTOR_MODE=production` (or `NODE_ENV=production`) refuses to start. Production rollback means fixing
the certificate path (re-export the CA, correct `MIKROTIK_API_TLS_SERVERNAME`, or re-pin
`MIKROTIK_API_TLS_FINGERPRINT256`) and restarting. A temporary plaintext diagnostic run requires an
explicitly non-production env (`CONNECTOR_MODE=local`, `NODE_ENV` unset or `development`), which also drops
the other production guards — owner approval only, loopback only, never left running behind the Tunnel.
