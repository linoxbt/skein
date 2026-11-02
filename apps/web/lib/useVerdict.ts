"use client";
import { useEffect, useState } from "react";
import { getBom, getPolicy, getVerdict, SkeinError } from "./api";
import { graphFromVerdict, type GraphState } from "./graph";
import type { Bom, PolicyDoc, VerdictObject } from "./types";

export interface VerdictState {
  v?: VerdictObject;
  bom?: Bom | null;
  policy?: PolicyDoc | null;
  graph?: GraphState;
  /** The id is unknown to the API (404). */
  notFound?: boolean;
  /** Anything else went wrong (network, CORS, 5xx, a failed run). */
  error?: string;
  /** Still being made: polled until it is sealed. */
  running?: boolean;
}

/** One verdict, its BOM and its policy; while it is still running, polled every 3 s (for up to 3 minutes). */
export function useVerdict(id: string | null | undefined) {
  const [state, setState] = useState<VerdictState>({});
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    const load = async () => {
      try {
        const v = await getVerdict(id);
        if (stop) return;
        if ("status" in v) {
          setState({ running: true });
          if (++polls < 60) timer = setTimeout(load, 3000);
          else setState({ error: "still running after 3 minutes; reload to check again" });
          return;
        }
        const [bom, policy] = await Promise.all([getBom(id).catch(() => null), getPolicy(`${v.policy.id}@${v.policy.version}`).catch(() => null)]);
        if (!stop) setState({ v, bom, policy, graph: graphFromVerdict(v, bom, policy) });
      } catch (e) {
        if (stop) return;
        if (e instanceof SkeinError && e.status === 404) setState({ notFound: true });
        else setState({ error: e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : `the Skein API did not answer (${String(e)})` });
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);
  return state;
}
