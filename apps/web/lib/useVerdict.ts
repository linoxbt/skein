"use client";
import { useEffect, useState } from "react";
import { getBom, getPolicy, getVerdict, SkeinError } from "./api";
import { graphFromVerdict, type GraphState } from "./graph";
import type { Bom, PolicyDoc, VerdictObject } from "./types";

export function useVerdict(id: string | null | undefined) {
  const [state, setState] = useState<{ v?: VerdictObject; bom?: Bom | null; policy?: PolicyDoc | null; graph?: GraphState; error?: string; running?: boolean }>({});
  useEffect(() => {
    if (!id) return;
    let stop = false;
    (async () => {
      try {
        const v = await getVerdict(id);
        if ("status" in v) {
          if (!stop) setState({ running: true });
          return;
        }
        const [bom, policy] = await Promise.all([getBom(id).catch(() => null), getPolicy(`${v.policy.id}@${v.policy.version}`).catch(() => null)]);
        if (!stop) setState({ v, bom, policy, graph: graphFromVerdict(v, bom, policy) });
      } catch (e) {
        if (!stop) setState({ error: e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e) });
      }
    })();
    return () => {
      stop = true;
    };
  }, [id]);
  return state;
}
