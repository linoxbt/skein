// Every minute, ask the Desk to settle any open application, so the queue
// moves with nobody watching. Netlify runs scheduled functions on published
// deploys only.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.DESK_CRON_SECRET;
  if (!base || !secret) return new Response("not configured", { status: 200 });
  const res = await fetch(`${base}/api/agent/tick`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "* * * * *" };
