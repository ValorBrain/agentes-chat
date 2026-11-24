import { pubsubRoundTrip } from "@agenteschat/adapters";
import { operatorRunOutcomes } from "@agenteschat/engine";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../http/errors";
import { json } from "../routes/app/context";
import type { OperatorDeps } from "./app";
import { Count, Instant } from "./runs";

const tags = ["Operator"];

/** The default window, and the widest one asked: a status sample reads minutes, never days. */
export const STATUS_SIGNALS_DEFAULT_MS = 15 * 60_000;
export const STATUS_SIGNALS_MAX_MS = 60 * 60_000;

const StatusSignals = z
  .object({
    from: z.string().openapi({ description: "ISO 8601, UTC." }),
    to: z.string().openapi({ description: "ISO 8601, UTC." }),
    runs: z.object({
      ended: Count.openapi({ description: "Runs created in the window that ended, `done` or `failed`." }),
      errors: z
        .array(z.object({ errorCode: z.string(), runs: Count }))
        .openapi({ description: "Of those, the `failed` ones by the app's error code, most frequent first." }),
      more: z.boolean().openapi({ description: "Too many different stored errors to count them all." }),
    }),
    realtime: z
      .object({
        roundTripMs: z.number().int().min(0).nullable().openapi({
          description:
            "How long an event published by this process took to come back to it through the pub/sub (Postgres LISTEN/NOTIFY with several replicas); null: it didn't within 5 seconds.",
        }),
      })
      .nullable()
      .openapi({ description: "Null on a server without live updates." }),
  })
  .openapi("OperatorStatusSignals");

const StatusQuery = z.object({
  from: Instant.optional().openapi({ description: "Runs created at or after. Default: 15 minutes before `to`." }),
  to: Instant.optional().openapi({ description: "Runs created before. Default: now." }),
});

/** What a status page samples each minute (ADR 0056): how agents' runs end and whether live updates get through. */
export function registerOperatorStatus(api: OpenAPIHono, { db, pubsub }: OperatorDeps) {
  api.openapi(
    createRoute({
      method: "get",
      path: "/status-signals",
      tags,
      summary: "How the instance's recent runs ended, by error code, and a live-update round trip",
      description: `Counts and one timing, across every workspace: never a run, a workspace or what anyone wrote. The window is at most ${STATUS_SIGNALS_MAX_MS / 60_000} minutes.`,
      request: { query: StatusQuery },
      responses: {
        200: json(StatusSignals),
        400: errorResponse("Invalid request"),
        401: errorResponse("Missing or wrong token"),
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      const to = query.to ? new Date(query.to) : new Date();
      const from = query.from ? new Date(query.from) : new Date(to.getTime() - STATUS_SIGNALS_DEFAULT_MS);
      const span = to.getTime() - from.getTime();
      if (span <= 0 || span > STATUS_SIGNALS_MAX_MS) {
        return apiError(
          c,
          400,
          "status.range",
          `from must be before to, at most ${STATUS_SIGNALS_MAX_MS / 60_000} minutes`,
        );
      }
      const [runs, roundTripMs] = await Promise.all([
        operatorRunOutcomes(db, { from, to }),
        pubsub ? pubsubRoundTrip(pubsub) : null,
      ]);
      return c.json(
        { from: from.toISOString(), to: to.toISOString(), runs, realtime: pubsub ? { roundTripMs } : null },
        200,
      );
    },
  );
}
