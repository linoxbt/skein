#!/usr/bin/env node
// Compares the live Railway project with infra/railway.json and exits 1 on any
// difference. Needs a Railway API token in RAILWAY_API_TOKEN (a team or
// account token); without one it sends no Authorization header, which works
// only where a proxy adds it.
//
//   node scripts/railway-drift.mjs            # report drift
//   node scripts/railway-drift.mjs --json     # machine-readable

import { readFileSync } from "node:fs";

const want = JSON.parse(readFileSync(new URL("../infra/railway.json", import.meta.url), "utf8"));
const token = process.env.RAILWAY_API_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`Railway API: ${body.errors.map((e) => e.message).join("; ")}`);
  return body.data;
}

const INSTANCE_FIELDS = [
  "dockerfilePath", "startCommand", "cronSchedule", "healthcheckPath", "healthcheckTimeout",
  "restartPolicyType", "restartPolicyMaxRetries", "drainingSeconds", "sleepApplication", "watchPatterns",
];

const live = await gql(
  `query ($env: String!) { environment(id: $env) { serviceInstances { edges { node {
    serviceName serviceId source { repo image } ${INSTANCE_FIELDS.join(" ")}
  } } } } }`,
  { env: want.environment },
);
const byId = new Map(live.environment.serviceInstances.edges.map((e) => [e.node.serviceId, e.node]));

/** Replicas are set per region and recorded on each deployment's manifest. */
async function replicas(serviceId) {
  const d = await gql(
    `query ($s: String!, $e: String!) { deployments(first: 1, input: { serviceId: $s, environmentId: $e, status: { in: [SUCCESS] } }) { edges { node { meta } } } }`,
    { s: serviceId, e: want.environment },
  );
  const deploy = d.deployments.edges[0]?.node.meta?.serviceManifest?.deploy;
  if (!deploy) return null;
  const regions = Object.values(deploy.multiRegionConfig ?? {});
  return regions.length ? regions.reduce((a, r) => a + (r?.numReplicas ?? 0), 0) : deploy.numReplicas ?? 1;
}

const norm = (v) => (v === null || v === undefined || v === false || (Array.isArray(v) && v.length === 0) ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

const drift = [];
for (const [name, w] of Object.entries(want.services)) {
  const l = byId.get(w.id);
  if (!l) {
    drift.push({ service: name, field: "(service)", want: w.id, live: "missing" });
    continue;
  }
  if (l.serviceName !== name) drift.push({ service: name, field: "name", want: name, live: l.serviceName });
  if (w.image !== undefined && !same(w.image, l.source?.image)) drift.push({ service: name, field: "image", want: w.image, live: l.source?.image });
  if (w.repo !== undefined && !same(w.repo, l.source?.repo)) drift.push({ service: name, field: "repo", want: w.repo, live: l.source?.repo });
  if (w.image === undefined) {
    for (const f of INSTANCE_FIELDS) if (!same(w[f], l[f])) drift.push({ service: name, field: f, want: w[f] ?? null, live: l[f] ?? null });
  }
  if (w.replicas !== undefined) {
    const r = await replicas(w.id);
    if (r !== w.replicas) drift.push({ service: name, field: "replicas", want: w.replicas, live: r });
  }
}
const known = new Set(Object.values(want.services).map((s) => s.id));
for (const [id, l] of byId) if (!known.has(id)) drift.push({ service: l.serviceName, field: "(service)", want: "absent from infra/railway.json", live: id });

if (process.argv.includes("--json")) console.log(JSON.stringify({ drift }, null, 2));
else if (drift.length === 0) console.log(`no drift: ${Object.keys(want.services).length} services match infra/railway.json`);
else for (const d of drift) console.log(`DRIFT ${d.service}.${d.field}: want ${JSON.stringify(d.want)}, live ${JSON.stringify(d.live)}`);
process.exit(drift.length ? 1 : 0);
