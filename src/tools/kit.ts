/**
 * Shared plumbing every tool uses, now on Slipway.
 *
 * Tool modules keep describing themselves with a Zod shape, a risk and a
 * handler. This adapter turns each into a Slipway tool, so the MCP server, the
 * CLI, the write guard, annotations and errors all come from the framework
 * instead of a copy kept in this repo.
 */

import { AuthError as SlipwayAuthError, SlipwayError, httpError, toolkit, z, type Risk, type Tool } from "@thenavidm/slipway";
import type { PhotosClient } from "../api/client.js";
import type { ClientPool } from "../api/pool.js";
import { selectAccount, type Account, type Config } from "../config.js";
import { AuthError, PhotosError } from "../api/errors.js";

/** What Slipway builds once per environment: every account's client, lazily. */
export type AppContext = {
  pool: ClientPool;
  config: Config;
};

/** What a handler receives: the context bound to the account this call names. */
export type ToolContext = {
  /** Already bound to the account this call names, or the default one. */
  client: PhotosClient;
  account: Account;
  config: Config;
};

const kit = toolkit<AppContext>();

/** The optional argument that picks an account, on every account-scoped tool. */
export const accountArg = {
  account: z
    .string()
    .optional()
    .describe(
      "Which connected Google account to act as, by the name it was configured under (or its email). Defaults to the first one. Call list_accounts to see them.",
    ),
};

/** Page size and cursor, on every paginating tool. */
export const pageArgs = {
  limit: z.number().int().min(1).max(100).optional().describe("How many to return per page, 1-100."),
  page_token: z
    .string()
    .optional()
    .describe(
      "Continue from a previous page. Pass the `next_page_token` from the last result. Omit for the first page.",
    ),
};

export type ToolSpec<S extends Shape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  /** True when the effect is visible to anyone but the account owner. */
  public?: boolean;
  /** True when calling twice has the same effect as calling once. */
  idempotent?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this is a write. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export type AnyToolSpec = Tool<AppContext>;

/**
 * Resolved lazily, on first access.
 *
 * describe_filter_capabilities and quota_status answer without touching the
 * API, and they have to keep working when no account is configured at all.
 * Resolving eagerly would make them throw "no account configured", which is
 * both wrong and the least helpful moment to say it.
 */
export function makeContext(
  pool: ClientPool,
  hint: string | undefined,
  config: Config,
): ToolContext {
  return {
    get client(): PhotosClient {
      return pool.for(hint);
    },
    get account(): Account {
      return selectAccount(config, hint);
    },
    config,
  };
}

/** Clamp a caller-supplied limit into a range the API will accept. */
export function clamp(value: number | undefined, fallback: number, max = 100): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/**
 * Kept so tool modules read the same, but never sent: Slipway adds `confirm`
 * to every irreversible tool itself, with one description everywhere.
 */
export const confirmArg = {
  confirm: z.boolean().optional(),
};

type Shape = Record<string, z.ZodType>;

/**
 * Google's HTTP status picks the exit code: 401 and 403 are 4, 404 is 3, 429
 * is 7, 400 is 2 and the rest 5. Google's own `status` enum and the hint that
 * names the cause ride along, because "PERMISSION_DENIED" plus the sentence on
 * which scope is missing is what lets a model retry correctly.
 */
export function toSlipway(error: PhotosError | AuthError): SlipwayError {
  if (error instanceof AuthError) return new SlipwayAuthError(error.message, { cause: error });
  const known = httpError(error.status, error.message);
  return new SlipwayError(known.message, known.code, known.exitCode, {
    status: error.status,
    ...(error.hint ? { hint: error.hint } : {}),
    details: { reason: error.reason },
    cause: error,
  });
}

export function defineTool<S extends Shape>(spec: ToolSpec<S>): Tool<AppContext> {
  const { confirm: _confirm, ...shape } = spec.schema as Shape;
  const handler = spec.handler as (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  return kit.defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: z.object(shape),
    risk: spec.risk,
    // 1.x's words for why an upload needs confirming, which the refusal and the approval form both say:
    // the Library API has no delete, so a wrong upload is removed by hand in the app.
    ...(spec.risk === "destructive" ? { consequence: "cannot be undone through the API" } : {}),
    ...(spec.idempotent !== undefined ? { idempotent: spec.idempotent } : {}),
    ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
    // Which account acts depends on the arguments, so the context is bound per call.
    handler: async (args, app) => {
      try {
        return await handler(args, makeContext(app.pool, (args as { account?: string }).account, app.config));
      } catch (error) {
        throw error instanceof PhotosError || error instanceof AuthError ? toSlipway(error) : error;
      }
    },
  });
}
