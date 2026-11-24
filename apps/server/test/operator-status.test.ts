import { afterAll, beforeAll, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import { createLogger } from "../src/logger";
import { createOperatorApp } from "../src/operator/app";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

const TOKEN = "operator-test-token-".padEnd(48, "x");

let t: TestServer;
beforeAll(async () => {
  t = await createTestServer({ env: { OPERATOR_API_TOKEN: TOKEN } });
});
afterAll(async () => {
  await t.close();
});

test("GET /status-signals counts the window's ended runs, its failures by code, and a live-update round trip", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const org = await seedOrg(owner);
  const now = Date.now();
  const run = (status: "done" | "failed" | "running", minutesAgo: number, error: string | null = null) => {
    const id = crypto.randomUUID();
    return {
      orgId: org.orgId,
      agentId: org.agentId,
      channelId: org.channelId,
      threadRootId: id,
      triggerMessageId: id,
      trigger: "mention" as const,
      hop: 1,
      status,
      error,
      createdAt: new Date(now - minutesAgo * 60_000),
    };
  };
  await t.db
    .insert(schema.agentRuns)
    .values([
      run("done", 2),
      run("done", 3),
      run("failed", 4, "bad_request"),
      run("failed", 5, "budget_exceeded"),
      run("failed", 6, "bad_request"),
      run("running", 1),
      run("failed", 40, "bad_request"),
    ]);

  const deps = { db: t.db, config: t.config, version: "test", log: createLogger("error") };
  const get = (app: ReturnType<typeof createOperatorApp>, query = "") =>
    app.request(`/api/operator/v1/status-signals${query}`, { headers: { authorization: `Bearer ${TOKEN}` } });

  const live = createOperatorApp({ ...deps, pubsub: t.adapters.pubsub }, TOKEN);
  const res = await get(live);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { runs: unknown; realtime: { roundTripMs: number | null } };
  expect(body.runs).toEqual({
    ended: 5,
    errors: [
      { errorCode: "run.our_error", runs: 2 },
      { errorCode: "run.budget_exceeded", runs: 1 },
    ],
    more: false,
  });
  expect(body.realtime.roundTripMs).toBeGreaterThanOrEqual(0);

  const wider = `?from=${new Date(now - 50 * 60_000).toISOString()}&to=${new Date(now).toISOString()}`;
  expect(((await (await get(live, wider)).json()) as { runs: { ended: number } }).runs.ended).toBe(6);
  expect(((await (await get(createOperatorApp(deps, TOKEN))).json()) as { realtime: null }).realtime).toBeNull();

  const tooWide = `?from=${new Date(now - 2 * 3600_000).toISOString()}`;
  expect((await get(live, tooWide)).status).toBe(400);
  expect(
    (await get(live, `?from=${new Date(now + 60_000).toISOString()}&to=${new Date(now).toISOString()}`)).status,
  ).toBe(400);
});
