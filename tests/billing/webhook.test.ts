/**
 * Unit tests for POST /api/billing/webhook
 *
 * Focus: the customer.subscription.deleted handler must:
 *   1. Fetch subdomain/custom_domain BEFORE clearing them
 *   2. Call invalidateTenantCache() for every hostname that was set
 *
 * The previous regression: the webhook cleared subdomain/custom_domain on the
 * organization row but never busted the Redis cache, so downgraded orgs
 * continued to resolve as club tenants until the 60s TTL expired.
 *
 * Strategy:
 *   - Stripe SDK is mocked — constructEvent() returns a hand-crafted event
 *   - adminClient() is mocked — controls what the "current org" select returns
 *   - invalidateTenantCache is mocked and spied on
 *   No real Supabase or Stripe connections needed.
 *
 * Run via: pnpm test:integration
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// invalidateTenantCache spy — declared via hoisted so it's available in the
// vi.mock factory below.
const mockInvalidateTenantCache = vi.hoisted(() =>
  vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)
);

vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: mockInvalidateTenantCache,
}));

// Stripe mock — mock the local getStripe() factory so vi.mock() reliably intercepts it.
const mockConstructEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockReturnValue({ webhooks: { constructEvent: mockConstructEvent } }),
}));

// adminClient mock — controls the Supabase query chain.
// We need two distinct behaviours from `.from("organizations")`:
//   SELECT …  .eq(…).maybeSingle()  → returns current org data
//   UPDATE … .eq(…)                 → returns success
const mockMaybeSingle = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  })
);

vi.mock("@/lib/api-auth", () => ({
  adminClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import { POST } from "@/app/api/billing/webhook/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWebhookRequest(event: object): Request {
  const body = JSON.stringify(event);
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": "sig_test", "content-type": "application/json" },
  });
}

function deletionEvent(subscriptionId: string) {
  return {
    type: "customer.subscription.deleted",
    data: { object: { id: subscriptionId } },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInvalidateTenantCache.mockClear();
  mockFrom.mockClear();
});

describe("POST /api/billing/webhook — customer.subscription.deleted cache invalidation", () => {
  it("invalidates the subdomain cache key when org has a subdomain", async () => {
    const event = deletionEvent("sub_jogafc_123");
    mockConstructEvent.mockReturnValue(event);
    mockMaybeSingle.mockResolvedValue({
      data: { subdomain: "jogafc", custom_domain: null },
      error: null,
    });

    const response = await POST(makeWebhookRequest(event));

    expect(response.status).toBe(200);
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("jogafc.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(1);
  });

  it("invalidates the custom domain cache key when org has a custom domain", async () => {
    const event = deletionEvent("sub_custom_456");
    mockConstructEvent.mockReturnValue(event);
    mockMaybeSingle.mockResolvedValue({
      data: { subdomain: null, custom_domain: "play.jogafc.com" },
      error: null,
    });

    const response = await POST(makeWebhookRequest(event));

    expect(response.status).toBe(200);
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("play.jogafc.com");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(1);
  });

  it("invalidates both keys when org has both subdomain and custom domain", async () => {
    const event = deletionEvent("sub_both_789");
    mockConstructEvent.mockReturnValue(event);
    mockMaybeSingle.mockResolvedValue({
      data: { subdomain: "bigclub", custom_domain: "app.bigclub.com" },
      error: null,
    });

    const response = await POST(makeWebhookRequest(event));

    expect(response.status).toBe(200);
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("bigclub.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("app.bigclub.com");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(2);
  });

  it("does not call invalidateTenantCache when org has no subdomain or custom domain", async () => {
    const event = deletionEvent("sub_free_000");
    mockConstructEvent.mockReturnValue(event);
    // Org never had a subdomain (e.g., was already on free plan)
    mockMaybeSingle.mockResolvedValue({
      data: { subdomain: null, custom_domain: null },
      error: null,
    });

    const response = await POST(makeWebhookRequest(event));

    expect(response.status).toBe(200);
    expect(mockInvalidateTenantCache).not.toHaveBeenCalled();
  });

  it("does not call invalidateTenantCache when the org row is not found", async () => {
    const event = deletionEvent("sub_ghost_999");
    mockConstructEvent.mockReturnValue(event);
    // Subscription ID doesn't match any org (shouldn't happen in practice)
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(makeWebhookRequest(event));

    expect(response.status).toBe(200);
    expect(mockInvalidateTenantCache).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/webhook — signature validation", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const request = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("missing_signature");
  });

  it("returns 400 when stripe signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const response = await POST(makeWebhookRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_signature");
  });
});
