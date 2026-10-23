import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthError } from "../src/auth-policy.js";
import { Database, AuthService } from "../src/auth.js";
import { bootstrap } from "../scripts/bootstrap-tenant.js";
import { migrate, assertDedicated } from "../scripts/db-migrate.js";
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL!,
  runtimeUrl = process.env.TEST_DATABASE_URL!;
assertDedicated(adminUrl, "test");
assertDedicated(runtimeUrl, "test");
test("operations PostgreSQL: local catalog and tables invariants", async () => {
  await migrate(adminUrl, "test");
  const admin = new Database(adminUrl),
    runtime = new Database(runtimeUrl),
    auth = new AuthService(runtime, "operations-test-secret-more-than-32bytes");
  try {
    await auth.initialize();
    const code = `ops-${randomUUID().slice(0, 8)}`,
      password = "Operations-test-password2026!";
    const a = await bootstrap(admin, {
      code,
      name: "Operations A",
      siteCode: "main",
      siteName: "Principal",
      username: "admin",
      password,
    });
    const l = await auth.login(
      { tenantCode: code, username: "admin", password },
      "ops-test",
    );
    const i = await auth.identify(l.token);
    const route = (method: string, suffix: string, body = {}) =>
      auth.authorized(i, undefined, (tr) =>
        auth.route(
          method,
          `/api/operations/sites/${a.siteId}${suffix}`,
          body,
          i,
          tr,
          new URL("http://localhost"),
        ),
      );
    assert.deepEqual(await route("GET", "/families"), { items: [] });
    const bad = async (fn: () => Promise<unknown>, code: string) =>
      assert.rejects(
        fn,
        (e: unknown) => e instanceof AuthError && e.code === code,
      );
    const family = (await route("POST", "/families", {
      code: "comida",
      name: "Comida",
    })) as Record<string, unknown>;
    const product = (await route("POST", "/products", {
      code: "menu",
      name: "Men�",
      familyId: family.id,
      priceCents: 1801,
    })) as Record<string, unknown>;
    assert.equal(product.quantity, 0);
    assert.equal(product.available, false);
    assert.equal(product.effectiveAvailable, false);
    assert.equal(product.priceCents, 1801);
    for (const priceCents of [-1, 0.1, 100000001, NaN, "1800"])
      await bad(
        () =>
          route("POST", "/products", {
            code: "invalid",
            name: "Invalid",
            familyId: family.id,
            priceCents,
          }),
        "VALIDATION_ERROR",
      );
    await bad(
      () =>
        route("POST", `/products/${product.id}/quantity`, {
          version: 1,
          quantity: -1,
          reason: "bad",
        }),
      "VALIDATION_ERROR",
    );
    const attempts = await Promise.allSettled([
      route("POST", `/products/${product.id}/quantity`, {
        version: 1,
        quantity: 4,
        reason: "Initial count",
      }),
      route("POST", `/products/${product.id}/quantity`, {
        version: 1,
        quantity: 5,
        reason: "Concurrent count",
      }),
    ]);
    assert.equal(attempts.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(
      attempts.filter(
        (v) => v.status === "rejected" && v.reason.code === "CONFLICT",
      ).length,
      1,
    );
    const enabled = (await route("PATCH", `/products/${product.id}`, {
      version: 2,
      available: true,
    })) as Record<string, unknown>;
    assert.equal(enabled.effectiveAvailable, true);
    await route("PATCH", `/families/${family.id}`, {
      version: 1,
      active: false,
    });
    assert.equal(
      (
        (await route("GET", "/products")) as {
          items: Record<string, unknown>[];
        }
      ).items[0]!.effectiveAvailable,
      false,
    );
    const sector = (await route("POST", "/sectors", {
      code: "salon",
      name: "Sal�n",
    })) as Record<string, unknown>;
    const table = (await route("POST", "/tables", {
      code: "m01",
      sectorId: sector.id,
      capacity: 4,
      x: 2,
      y: 3,
    })) as Record<string, unknown>;
    const requestId = randomUUID(),
      open = { requestId, tableId: table.id, waiterId: a.userId, guests: 2 };
    await bad(
      () => route("POST", "/attentions", { ...open, guests: 5 }),
      "VALIDATION_ERROR",
    );
    const openings = await Promise.all([
      route("POST", "/attentions", open),
      route("POST", "/attentions", open),
    ]);
    assert.deepEqual(openings[0], openings[1]);
    const att = openings[0] as Record<string, unknown>;
    assert.equal(att.waiterName, "admin");
    await bad(
      () => route("POST", "/attentions", { ...open, guests: 3 }),
      "CONFLICT",
    );
    await bad(
      () => route("POST", "/attentions", { ...open, requestId: randomUUID() }),
      "CONFLICT",
    );
    await bad(
      () =>
        route("PATCH", `/tables/${table.id}`, { version: 1, active: false }),
      "CONFLICT",
    );
    await bad(
      () =>
        route("PATCH", `/sectors/${sector.id}`, { version: 1, active: false }),
      "CONFLICT",
    );
    const tables = (await route("GET", "/tables")) as {
      items: Record<string, unknown>[];
    };
    assert.equal(tables.items[0]!.state, "occupied");
    await bad(
      () => route("POST", `/attentions/${att.id}/cancel`, { reason: " " }),
      "VALIDATION_ERROR",
    );
    await route("POST", `/attentions/${att.id}/cancel`, {
      reason: "Demostraci�n vac�a",
    });
    assert.equal(
      (
        (await route("GET", "/tables")) as {
          items: Record<string, unknown>[];
        }
      ).items[0]!.state,
      "free",
    );
    assert.equal(
      ((await route("POST", "/attentions", open)) as Record<string, unknown>)
        .status,
      "cancelled",
    );
    const second = (await route("POST", "/attentions", {
      ...open,
      requestId: randomUUID(),
    })) as Record<string, unknown>;
    await admin.exec(
      "UPDATE restaurant.attentions SET consumption_count=1 WHERE id=$1",
      [second.id],
    );
    await bad(
      () =>
        route("POST", `/attentions/${second.id}/cancel`, {
          reason: "Has consumption",
        }),
      "CONFLICT",
    );
    await admin.exec(
      "UPDATE restaurant.attentions SET consumption_count=0 WHERE id=$1",
      [second.id],
    );
    await route("POST", `/attentions/${second.id}/cancel`, {
      reason: "Empty again",
    });
    const b = await bootstrap(admin, {
      code: `other-${randomUUID().slice(0, 8)}`,
      name: "B",
      siteCode: "main",
      siteName: "B local",
      username: "admin",
      password,
    });
    const isolatedSite = randomUUID();
    await admin.exec(
      "INSERT INTO restaurant.sites(id,tenant_id,code,name) VALUES($1,$2,'secondary','Secondary')",
      [isolatedSite, a.tenantId],
    );
    const at = (site: string, method: string, suffix: string, body = {}) =>
      auth.authorized(i, undefined, (tr) =>
        auth.route(
          method,
          `/api/operations/sites/${site}${suffix}`,
          body,
          i,
          tr,
          new URL("http://localhost"),
        ),
      );
    await bad(() => at(isolatedSite, "GET", "/families"), "NOT_FOUND");
    await bad(() => at(b.siteId, "GET", "/families"), "NOT_FOUND");
    await admin.exec("INSERT INTO restaurant.user_sites VALUES($1,$2,$3)", [
      a.tenantId,
      a.userId,
      isolatedSite,
    ]);
    assert.deepEqual(await at(isolatedSite, "GET", "/products"), { items: [] });
    await bad(
      () =>
        at(isolatedSite, "POST", "/products", {
          code: "cross",
          name: "Cross local",
          familyId: family.id,
          priceCents: 10,
        }),
      "NOT_FOUND",
    );
    assert.equal(
      (await runtime.query("SELECT id FROM restaurant.products")).length,
      0,
    );
    await assert.rejects(() =>
      runtime.tenant(a.tenantId, (tr) =>
        runtime.exec(
          "INSERT INTO restaurant.products(id,tenant_id,site_id,family_id,code,name,price_cents) VALUES($1,$2,$3,$4,$5,$6,1)",
          [
            randomUUID(),
            a.tenantId,
            isolatedSite,
            family.id,
            "sqlcross",
            "Cross",
          ],
          tr,
        ),
      ),
    );
    // Audit failure must roll back both quantity and adjustment history.
    const prior = auth.audit.bind(auth);
    auth.audit = async () => {
      throw new Error("Injected audit failure");
    };
    await assert.rejects(
      () =>
        route("POST", `/products/${product.id}/quantity`, {
          version: 3,
          quantity: 99,
          reason: "Must roll back",
        }),
      /Injected audit failure/,
    );
    auth.audit = prior;
    const after = (
      (await route("GET", "/products")) as {
        items: Record<string, unknown>[];
      }
    ).items[0]!;
    assert.equal(after.version, 3);
    assert.notEqual(after.quantity, 99);
    const [counts] = await admin.query(
      "SELECT count(*)::int n FROM restaurant.quantity_adjustments WHERE product_id=$1",
      [product.id],
    );
    assert.equal(counts!.n, 1);
    await bad(
      () =>
        auth.authorized(i, undefined, (tr) =>
          auth.route(
            "PATCH",
            `/api/users/${a.userId}`,
            { active: false },
            i,
            tr,
            new URL("http://localhost"),
          ),
        ),
      "LAST_ADMIN",
    );
    const [events] = await admin.query(
      "SELECT count(*)::int n FROM restaurant.operation_events WHERE tenant_id=$1",
      [a.tenantId],
    );
    assert(Number(events!.n) > 5);
  } finally {
    await runtime.close();
    await admin.close();
  }
});
