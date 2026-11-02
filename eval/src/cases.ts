import { z } from "zod";

/**
 * One labelled token (spec section 14). Every label carries the public source
 * it rests on; as_of_block pins the state the label describes (D7).
 */
export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,64}$/),
    chainId: z.union([z.literal(1), z.literal(56), z.literal(8453), z.literal(42161)]),
    token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    label: z.enum(["good", "bad", "ambiguous"]),
    labelSourceUrl: z.string().url().startsWith("https://"),
    labelEventAt: z.string().datetime().optional(),
    asOfBlock: z.number().int().positive(),
    split: z.enum(["tune", "holdout"]),
    context: z.object({ deployer: z.string().optional(), socialHandle: z.string().optional(), repoUrl: z.string().optional() }).strict().default({}),
    notes: z.string().max(500).optional(),
  })
  .strict();

export type Case = z.output<typeof caseSchema>;

export const casesFileSchema = z
  .object({
    /** "example" files are for testing the harness and are never reported as results. */
    kind: z.enum(["labelled", "example"]),
    cases: z.array(caseSchema),
  })
  .strict()
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const c of f.cases) {
      if (ids.has(c.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate case id ${c.id}` });
      ids.add(c.id);
    }
  });

export type CasesFile = z.output<typeof casesFileSchema>;
