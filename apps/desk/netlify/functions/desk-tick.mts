// Every minute, start the Desk's agent so the queue moves with nobody
// watching: the intake files fresh launches and every open application is
// settled. The work runs in the background function (desk-agent-background,
// up to 15 minutes), because a scheduled function has 30 s and a Telegraph
// ask must never be cut off after it has paid. If the background function
// does not take the run, the tick route does it in a request function.
// Netlify runs scheduled functions on published deploys only.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.DESK_CRON_SECRET;
  if (!base || !secret) return new Response("not configured", { status: 200 });
  const auth = { authorization: `Bearer ${secret}` };
  const bg = await fetch(`${base}/.netlify/functions/desk-agent-background`, { method: "POST", headers: auth, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (bg?.status === 202) return new Response("started the background agent", { status: 200 });
  const res = await fetch(`${base}/api/agent/tick`, { method: "POST", headers: auth });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "* * * * *" };
