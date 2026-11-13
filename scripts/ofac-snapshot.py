#!/usr/bin/env python3
"""Builds packages/pipeline/data/ofac-sdn-evm.json from OFAC's SDN list.

  curl -sSLo sdn.csv https://www.treasury.gov/ofac/downloads/sdn.csv
  curl -sSLo sdn_comments.csv https://www.treasury.gov/ofac/downloads/sdn_comments.csv
  python3 scripts/ofac-snapshot.py sdn.csv sdn_comments.csv

Keeps every "Digital Currency Address" that is an EVM address (0x + 40 hex;
the same address on every EVM chain), with the SDN entry's uid and name.

OFAC cuts an entry's remarks at a fixed length and continues them in
sdn_comments.csv (ent_num, remarks), so an entry with many addresses has some
of them only there: on 2026-11-13, 31 of 125 EVM addresses. Both files are read.

Traceability: each file's sha256 is recorded under "sources", and
"sourceSha256" (what a verdict's finding cites as listSha256) is the sha256 of
the two sha256 hex digests joined by a newline, in the order above, so anyone
holding Treasury's two files can recompute it.

After a refresh, append the previous sourceSha256 to SHIPPED_SDN_SNAPSHOTS in
packages/pipeline/src/ofac.ts, never replace it: older verdicts cite it.
"""
import csv, hashlib, json, re, sys, datetime

ADDR = re.compile(r"Digital Currency Address - ([A-Za-z0-9]+) (0x[0-9a-fA-F]{40})\b")

if len(sys.argv) != 3:
    sys.exit("usage: python3 scripts/ofac-snapshot.py sdn.csv sdn_comments.csv")
sdn_path, comments_path = sys.argv[1], sys.argv[2]
sdn_raw = open(sdn_path, "rb").read()
comments_raw = open(comments_path, "rb").read()

names = {}
out = {}


def add(uid, name, text):
    for m in ADDR.finditer(text):
        a = m.group(2).lower()
        e = {"sdnUid": uid, "name": name, "currency": m.group(1)}
        if e not in out.setdefault(a, []):
            out[a].append(e)


for r in csv.reader(sdn_raw.decode("latin-1").splitlines()):
    if len(r) < 12:
        continue
    uid, name = r[0].strip(), r[1].strip()
    names[uid] = name
    add(uid, name, r[11])

from_comments = 0
for r in csv.reader(comments_raw.decode("latin-1").splitlines()):
    if len(r) < 2:
        continue
    uid = r[0].strip()
    before = len(out)
    # A continuation belongs to an entry in sdn.csv; one that does not is kept under its uid.
    add(uid, names.get(uid, f"SDN entry {uid}"), ",".join(r[1:]))
    from_comments += len(out) - before

digests = [hashlib.sha256(sdn_raw).hexdigest(), hashlib.sha256(comments_raw).hexdigest()]
snap = {
    "list": "OFAC SDN",
    "source": "https://www.treasury.gov/ofac/downloads/sdn.csv",
    "sources": [
        {"url": "https://www.treasury.gov/ofac/downloads/sdn.csv", "sha256": digests[0]},
        {"url": "https://www.treasury.gov/ofac/downloads/sdn_comments.csv", "sha256": digests[1]},
    ],
    "fetched": datetime.date.today().isoformat(),
    "sourceSha256": hashlib.sha256("\n".join(digests).encode()).hexdigest(),
    "addresses": dict(sorted(out.items())),
}
path = "packages/pipeline/data/ofac-sdn-evm.json"
json.dump(snap, open(path, "w"), indent=1)
open(path, "a").write("\n")
print(f"{len(out)} EVM addresses ({from_comments} only in sdn_comments.csv) -> {path}; sourceSha256 {snap['sourceSha256']}")
