import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Test the send-alerts cron route.
 *
 * The route touches three boundaries we mock explicitly:
 *   - isAuthorizedCron (auth gate)            → @/lib/cron-auth
 *   - adminClient() (supabase reads + writes) → @/lib/supabase/admin
 *   - sendAlertEmail (email delivery)         → @/lib/alerts/send
 *
 * The supabase mock is table-aware so we can both feed deterministic read
 * payloads AND capture the rows persisted by alert_sends inserts and
 * alert_subscriptions updates — letting us assert on actual recipient
 * selection and persisted status rather than "a mock was called".
 *
 * Chain shapes used by the route, per table:
 *   alert_subscriptions.select(...).eq("confirmed", true)        → terminal read
 *   live_incidents.select(...).gte().order().limit()             → terminal read
 *   alert_sends.select(...).in("live_incident_id", ids)          → terminal read
 *   alert_sends.insert(row)                                       → awaited write
 *   alert_subscriptions.update(row).eq("id", id)                 → awaited write
 */

const isAuthorizedCron = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCron }));

const sendAlertEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerts/send", () => ({ sendAlertEmail }));

const adminFactoryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ adminClient: adminFactoryMock }));

interface SubRow {
  id: string;
  email: string;
  neighborhoods: string[];
  min_severity: "low" | "med" | "high";
  unsubscribe_token: string;
  last_sent_at: string | null;
}
interface LiveRow {
  id: string;
  title: string;
  subtitle: string | null;
  severity: "low" | "med" | "high";
  neighborhood: string | null;
  address: string | null;
  occurred_at: string;
}
interface SentPair {
  subscription_id: string;
  live_incident_id: string;
}

interface ClientConfig {
  subs?: SubRow[];
  subsError?: string;
  live?: LiveRow[];
  liveError?: string;
  alreadySent?: SentPair[];
}

interface InsertRecord {
  subscription_id: string;
  live_incident_id: string;
  channel: string;
  status: string;
  sent_at: string | null;
}
interface UpdateRecord {
  patch: Record<string, unknown>;
  id: string;
}

function buildAdminClient(cfg: ClientConfig) {
  const inserts: InsertRecord[] = [];
  const subscriptionUpdates: UpdateRecord[] = [];

  function makeChain(table: string): Record<string, unknown> {
    const proxy: Record<string, unknown> = {};
    let pendingUpdatePatch: Record<string, unknown> | null = null;

    proxy.select = vi.fn(() => proxy);
    proxy.order = vi.fn(() => proxy);
    proxy.gte = vi.fn(() => proxy);

    // alert_subscriptions read terminates on .eq("confirmed", true);
    // a per-row subscription update terminates on .eq("id", <id>).
    proxy.eq = vi.fn((col: string, val: unknown) => {
      if (table === "alert_subscriptions" && pendingUpdatePatch) {
        subscriptionUpdates.push({ patch: pendingUpdatePatch, id: String(val) });
        pendingUpdatePatch = null;
        return Promise.resolve({ data: null, error: null });
      }
      if (table === "alert_subscriptions") {
        return cfg.subsError
          ? Promise.resolve({ data: null, error: { message: cfg.subsError } })
          : Promise.resolve({ data: cfg.subs ?? [], error: null });
      }
      return proxy;
    });

    // live_incidents read terminates on .limit()
    proxy.limit = vi.fn(() =>
      cfg.liveError
        ? Promise.resolve({ data: null, error: { message: cfg.liveError } })
        : Promise.resolve({ data: cfg.live ?? [], error: null }),
    );

    // alert_sends read terminates on .in(...)
    proxy.in = vi.fn(() =>
      Promise.resolve({ data: cfg.alreadySent ?? [], error: null }),
    );

    // alert_sends insert — capture the persisted row and resolve.
    proxy.insert = vi.fn((row: InsertRecord) => {
      inserts.push(row);
      return Promise.resolve({ data: null, error: null });
    });

    // alert_subscriptions update — stash the patch; the following .eq("id")
    // records it against the subscription id.
    proxy.update = vi.fn((patch: Record<string, unknown>) => {
      pendingUpdatePatch = patch;
      return proxy;
    });

    return proxy;
  }

  const from = vi.fn((table: string) => makeChain(table));
  return { client: { from }, inserts, subscriptionUpdates, fromMock: from };
}

import { GET } from "./route";

interface EmailArgs {
  to: string;
  subject: string;
  body: string;
  unsubscribeToken: string;
}
function emailArgs(): EmailArgs[] {
  return sendAlertEmail.mock.calls.map((c) => c[0] as EmailArgs);
}

function makeReq(auth = "Bearer ok"): NextRequest {
  return new NextRequest("http://localhost/api/cron/send-alerts", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

const FROZEN = new Date("2026-06-09T12:00:00.000Z");

beforeEach(() => {
  isAuthorizedCron.mockReset();
  sendAlertEmail.mockReset();
  adminFactoryMock.mockReset();
  isAuthorizedCron.mockReturnValue(true);
  sendAlertEmail.mockResolvedValue({ ok: true });
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});

afterEach(() => {
  vi.useRealTimers();
});

function sub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: "sub-1",
    email: "a@example.com",
    neighborhoods: [],
    min_severity: "low",
    unsubscribe_token: "tok-1",
    last_sent_at: null,
    ...overrides,
  };
}
function inc(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    id: "inc-1",
    title: "Fire reported",
    subtitle: null,
    severity: "high",
    neighborhood: "Mission",
    address: null,
    occurred_at: "2026-06-09T11:50:00.000Z",
    ...overrides,
  };
}

describe("GET /api/cron/send-alerts", () => {
  // Behavior 1
  it("returns 401 and sends nothing when unauthorized", async () => {
    isAuthorizedCron.mockReturnValue(false);
    const { client, inserts } = buildAdminClient({});
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(sendAlertEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    // adminClient is never even constructed on the unauthorized path.
    expect(adminFactoryMock).not.toHaveBeenCalled();
  });

  // Behavior 2
  it("returns a zero-send no_subscribers response when there are no subscribers", async () => {
    const { client } = buildAdminClient({ subs: [] });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 0, reason: "no_subscribers" });
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  // Behavior 3
  it("returns a zero-send no_recent_incidents response when nothing is recent", async () => {
    const { client, inserts } = buildAdminClient({ subs: [sub()], live: [] });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      sent: 0,
      reason: "no_recent_incidents",
    });
    expect(sendAlertEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  // Behavior 4
  it("selects only incidents at or above the subscription severity threshold", async () => {
    const { client } = buildAdminClient({
      subs: [sub({ min_severity: "med" })],
      live: [
        inc({ id: "low-1", severity: "low" }),
        inc({ id: "med-1", severity: "med" }),
        inc({ id: "high-1", severity: "high" }),
      ],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.sent).toBe(2);
    const subjects = emailArgs().map((c) => c.subject);
    // low is filtered out; med + high reach the recipient.
    expect(subjects.some((s: string) => s.startsWith("[MED]"))).toBe(true);
    expect(subjects.some((s: string) => s.startsWith("[HIGH]"))).toBe(true);
    expect(subjects.some((s: string) => s.startsWith("[LOW]"))).toBe(false);
  });

  // Behavior 5
  it("applies neighborhood filters to recipient selection", async () => {
    const { client } = buildAdminClient({
      subs: [sub({ neighborhoods: ["Mission"] })],
      live: [
        inc({ id: "mission-1", neighborhood: "Mission" }),
        inc({ id: "soma-1", neighborhood: "SOMA" }),
        inc({ id: "none-1", neighborhood: null }),
      ],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();
    // Only the Mission incident matches; SOMA and the null-neighborhood
    // incident are excluded.
    expect(json.sent).toBe(1);
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(emailArgs()[0]?.subject).toContain("Mission");
  });

  // Behavior 6
  it("does not resend a subscription/incident pair already recorded as sent", async () => {
    const { client, inserts } = buildAdminClient({
      subs: [sub({ id: "sub-1" })],
      live: [inc({ id: "inc-1" }), inc({ id: "inc-2" })],
      alreadySent: [{ subscription_id: "sub-1", live_incident_id: "inc-1" }],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();
    // inc-1 is deduped; only inc-2 goes out.
    expect(json.sent).toBe(1);
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    const persistedIncidentIds = inserts.map((i) => i.live_incident_id);
    expect(persistedIncidentIds).toEqual(["inc-2"]);
  });

  // Behavior 7
  it("persists a sent record and updates last_sent_at on a successful email", async () => {
    const { client, inserts, subscriptionUpdates } = buildAdminClient({
      subs: [sub({ id: "sub-1" })],
      live: [inc({ id: "inc-1" })],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    expect(inserts).toEqual([
      {
        subscription_id: "sub-1",
        live_incident_id: "inc-1",
        channel: "email",
        status: "sent",
        sent_at: FROZEN.toISOString(),
      },
    ]);
    expect(subscriptionUpdates).toEqual([
      { patch: { last_sent_at: FROZEN.toISOString() }, id: "sub-1" },
    ]);
  });

  // Behavior 8
  it("persists a failed record, surfaces the error, and does not update last_sent_at on a failed email", async () => {
    sendAlertEmail.mockResolvedValue({ ok: false, error: "resend 500: boom" });
    const { client, inserts, subscriptionUpdates } = buildAdminClient({
      subs: [sub({ id: "sub-1", email: "a@example.com" })],
      live: [inc({ id: "inc-1" })],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();

    expect(json.sent).toBe(0);
    expect(json.errors).toEqual(["a@example.com:inc-1:resend 500: boom"]);
    expect(inserts).toEqual([
      {
        subscription_id: "sub-1",
        live_incident_id: "inc-1",
        channel: "email",
        status: "failed",
        sent_at: null,
      },
    ]);
    // No last_sent_at bump on failure.
    expect(subscriptionUpdates).toHaveLength(0);
  });

  // Behavior 9
  it("enforces the 50-email per-run cap", async () => {
    const oneSub = sub({ id: "sub-1", min_severity: "low", neighborhoods: [] });
    const manyIncidents = Array.from({ length: 60 }, (_, i) =>
      inc({ id: `inc-${i}`, severity: "high", neighborhood: null }),
    );
    const { client, inserts } = buildAdminClient({
      subs: [oneSub],
      live: manyIncidents,
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.sent).toBe(50);
    expect(sendAlertEmail).toHaveBeenCalledTimes(50);
    // Exactly 50 send records persisted — the cap halts further work.
    expect(inserts).toHaveLength(50);
  });

  // Behavior 10
  it("returns correct sent / subscribers / incidents counters", async () => {
    const { client } = buildAdminClient({
      subs: [
        sub({ id: "sub-1", neighborhoods: [], min_severity: "low" }),
        sub({ id: "sub-2", email: "b@example.com", neighborhoods: ["SOMA"] }),
      ],
      live: [
        inc({ id: "inc-1", neighborhood: "Mission", severity: "high" }),
        inc({ id: "inc-2", neighborhood: "SOMA", severity: "high" }),
      ],
    });
    adminFactoryMock.mockReturnValue(client);

    const res = await GET(makeReq());
    const json = await res.json();
    // sub-1 (no filter) gets both incidents = 2; sub-2 (SOMA only) gets inc-2 = 1.
    expect(json).toMatchObject({
      ok: true,
      sent: 3,
      subscribers: 2,
      incidents: 2,
    });
  });
});
