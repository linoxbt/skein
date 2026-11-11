#!/usr/bin/env python3
"""Builds packages/pipeline/data/ofac-sdn-evm.json from OFAC's SDN list.

  curl -sSLo sdn.csv https://www.treasury.gov/ofac/downloads/sdn.csv
  python3 scripts/ofac-snapshot.py sdn.csv

Keeps every "Digital Currency Address" that is an EVM address (0x + 40 hex;
the same address on every EVM chain), with the SDN entry's uid and name.
The file's sha256 is recorded, so each match can be traced to the exact list.
"""
import csv, hashlib, json, re, sys, datetime

src = sys.argv[1]
raw = open(src, "rb").read()
rows = csv.reader(raw.decode("latin-1").splitlines())
out = {}
for r in rows:
    if len(r) < 12:
        continue
    for m in re.finditer(r"Digital Currency Address - ([A-Za-z0-9]+) (0x[0-9a-fA-F]{40})\b", r[11]):
        a = m.group(2).lower()
        e = {"sdnUid": r[0].strip(), "name": r[1].strip(), "currency": m.group(1)}
        if e not in out.setdefault(a, []):
            out[a].append(e)
snap = {
    "list": "OFAC SDN",
    "source": "https://www.treasury.gov/ofac/downloads/sdn.csv",
    "fetched": datetime.date.today().isoformat(),
    "sourceSha256": hashlib.sha256(raw).hexdigest(),
    "addresses": dict(sorted(out.items())),
}
path = "packages/pipeline/data/ofac-sdn-evm.json"
json.dump(snap, open(path, "w"), indent=1)
open(path, "a").write("\n")
print(f"{len(out)} EVM addresses -> {path}")
