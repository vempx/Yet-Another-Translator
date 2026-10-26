# Offline domain root data

`iana-tlds.txt` is the IANA alphabetical list of delegated top-level domains.

- Source: https://data.iana.org/TLD/tlds-alpha-by-domain.txt
- Snapshot: version 2026102600, 2026-10-26 UTC; 1437 ASCII/punycode labels.
- SHA-256: `b5c212c638c3db9c3bc4db16853cb5acaf4d66f9cbbb4baad658acdb049b311a`.

The plugin bundles this data and does not fetch it at runtime. Public suffix evidence distinguishes bare hosts from dotted file/identifier text; it is not a list of file extensions and not a DNS or reachability check. Explicit HTTP(S), www, port and network-path syntax are checked even when their suffix is not in this snapshot.

To refresh during development, download the source to `data/iana-tlds.txt`, inspect its date/content, and run:

```powershell
node scripts/bundle_domain_roots.cjs
node scripts/bundle_domain_roots.cjs --check
node --test YetAnotherTranslator.test.cjs
```

The bundler is offline, validates the snapshot and only replaces the marked constant in the plugin. CI checks that the source snapshot and bundled roots agree. Newly delegated roots require a future snapshot update; explicit URLs remain protected independently of root membership.
