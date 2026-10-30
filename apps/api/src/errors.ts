import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "INVALID_SUBJECT"
  | "INVALID_REQUEST"
  | "UNKNOWN_POLICY"
  | "UNAUTHORIZED"
  | "PAYMENT_REQUIRED"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "BUDGET_TOO_LOW"
  | "RATE_LIMITED"
  | "DAILY_CAP_REACHED"
  | "UPSTREAM_UNAVAILABLE"
  | "MARGIN_GUARD"
  | "SELF_ROUTING"
  | "TIMEOUT";

/** Every error body is { error: { code, message, details } }. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, e: ApiError) {
  for (const [k, v] of Object.entries(e.headers ?? {})) c.header(k, v);
  return c.json({ error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } }, e.status);
}
