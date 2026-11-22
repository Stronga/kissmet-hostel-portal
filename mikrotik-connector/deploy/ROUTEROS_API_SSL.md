# RouterOS api-ssl (8729) for the connector — router-side steps (DOCUMENTATION ONLY)

Nothing here has been run. These are **live router changes** and need the owner's explicit approval,
a fresh `/export` + binary backup first, and an on-site person in case of lock-out. Keep the working
8728 path until 8729 is validated from the Pi.

Connector side (already implemented, mock-tested): `MIKROTIK_API_TLS=true`, port defaults to 8729,
`MIKROTIK_API_TLS_CA_FILE` required (chain always verified, TLS >= 1.2), optional
`MIKROTIK_API_TLS_FINGERPRINT256` pin, optional `MIKROTIK_API_TLS_SERVERNAME`.
`MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY` is refused in production. 8728 + TLS is refused.

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

`/ip service set api disabled=no address=<PI_LAN_IP>/32` and set the connector back to
`MIKROTIK_API_TLS=false`, `MIKROTIK_API_PORT=8728`; restart the connector.
