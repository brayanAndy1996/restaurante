import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { Database, AuthService, type Row } from "../src/auth.js";
import { PERMISSIONS, ADMIN_PERMISSIONS } from "../src/auth-policy.js";
import { bootstrap } from "../scripts/bootstrap-tenant.js";
import { assertDedicated } from "../scripts/db-migrate.js";
import { createHttpServer } from "../src/server.js";

// Independent, random fixtures only. Migration and demo execution belong to other suites.
test("independent operations attacks against real PostgreSQL", async (t) => {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  assert.ok(adminUrl && runtimeUrl);
  assertDedicated(adminUrl, "test");
  assertDedicated(runtimeUrl, "test");
  const admin = new Database(adminUrl),
    runtime = new Database(runtimeUrl);
  const secret = randomBytes(32).toString("hex");
  const auth = new AuthService(runtime, secret);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const codes = [`opsa_${suffix}`, `opsb_${suffix}`];
  const password = `Adversarial-${suffix}!`;
  const tenants: string[] = [];
  const usernames = new Set(["admin"]);
  const origin = "http://127.0.0.1:3000";
  const server = await createHttpServer(
    { mode: "cloud", host: "127.0.0.1", port: 3000 },
    { auth, origin },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  type Session = { cookie: string; csrf: string };
  async function req(
    path: string,
    method = "GET",
    body?: Row,
    session?: Session,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: (await response.json()) as Row,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(code: string, username = "admin"): Promise<Session> {
    usernames.add(username);
    const r = await req("/api/auth/login", "POST", {
      tenantCode: code,
      username,
      password,
    });
    assert.equal(r.status, 200);
    assert.ok(r.cookie);
    return { cookie: r.cookie, csrf: String(r.data.csrfToken) };
  }
  const failures: Error[] = [];
  async function scenario(name: string, run: () => Promise<void>) {
    try {
      await run();
      t.diagnostic(`PASS ${name}`);
    } catch (cause) {
      failures.push(new Error(name, { cause }));
      t.diagnostic(`FAIL ${name}: ${String(cause)}`);
    }
  }
  try {
    const [marker] = await admin.query(
      "SELECT value FROM restaurant.metadata WHERE key='environment'",
    );
    assert.equal(marker?.value, "test");
    await auth.initialize();
    const fixtures = [];
    for (const code of codes) {
      const fixture = await bootstrap(admin, {
        code,
        name: "Independent operations",
        siteCode: "main",
        siteName: "Main",
        username: "admin",
        password,
      });
      fixtures.push(fixture);
      tenants.push(fixture.tenantId);
    }
    const a = fixtures[0]!,
      b = fixtures[1]!;
    const sa = await login(codes[0]!),
      sb = await login(codes[1]!);
    const secondSite = randomUUID();
    await admin.exec(
      "INSERT INTO restaurant.sites(id,tenant_id,code,name) VALUES($1,$2,'second','Second')",
      [secondSite, a.tenantId],
    );
    const path = (site: string, suffix: string) =>
      `/api/operations/sites/${site}${suffix}`;
    async function ok(
      suffix: string,
      method = "GET",
      body?: Row,
      session = sa,
      site = a.siteId,
    ) {
      const r = await req(path(site, suffix), method, body, session);
      assert.equal(
        r.status,
        200,
        `${method} ${suffix}: ${JSON.stringify(r.data)}`,
      );
      return r.data;
    }
    async function user(
      username: string,
      permissions: readonly string[],
      sites = [a.siteId],
    ) {
      const role = await req(
        "/api/roles",
        "POST",
        { name: username, permissions },
        sa,
      );
      assert.equal(role.status, 200);
      const r = await req(
        "/api/users",
        "POST",
        { username, password, roleIds: [role.data.id], siteIds: sites },
        sa,
      );
      assert.equal(r.status, 200);
      return {
        id: String(r.data.id),
        roleId: String(role.data.id),
        session: await login(codes[0]!, username),
      };
    }
    const f = await ok("/families", "POST", { code: " FOOD ", name: " Food " });
    const sector = await ok("/sectors", "POST", { code: "main", name: "Main" });
    const table = await ok("/tables", "POST", {
      code: "t1",
      sectorId: sector.id,
      capacity: 4,
      x: null,
      y: 10000,
    });
    const p = await ok("/products", "POST", {
      code: "meal",
      name: "Meal",
      familyId: f.id,
      priceCents: 1234,
    });
    const fb = await ok(
      "/families",
      "POST",
      { code: "food", name: "Other tenant" },
      sb,
      b.siteId,
    );
    const waiter = await user("waiter", ["mesas.operar"]);
    const limited = await user("limited", ["carta.consultar"]);
    const noSite = await user("nositeadmin", PERMISSIONS, []);

    await scenario(
      "tenant/local isolation includes administrator without membership",
      async () => {
        assert.equal(
          (await req(path(b.siteId, "/products"), "GET", undefined, sa)).status,
          404,
        );
        assert.equal(
          (await req(path(secondSite, "/products"), "GET", undefined, sa))
            .status,
          404,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/products"),
              "GET",
              undefined,
              noSite.session,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/products"),
              "POST",
              { code: "cross", name: "Cross", familyId: fb.id, priceCents: 1 },
              sa,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/families"),
              "POST",
              { code: "no", name: "No" },
              limited.session,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/waiters"),
              "GET",
              undefined,
              limited.session,
            )
          ).status,
          403,
        );
      },
    );

    await scenario(
      "strict money, quantities, coordinates, identifiers and unknown fields",
      async () => {
        assert.equal(f.code, "food");
        assert.equal(f.name, "Food");
        assert.equal(p.quantity, 0);
        assert.equal(p.available, false);
        assert.equal(p.effectiveAvailable, false);
        for (const priceCents of [-1, 0.1, 100000001, "123", null, true]) {
          assert.equal(
            (
              await req(
                path(a.siteId, "/products"),
                "POST",
                {
                  code: "invalid",
                  name: "Invalid",
                  familyId: f.id,
                  priceCents,
                },
                sa,
              )
            ).status,
            400,
          );
        }
        for (const body of [
          { version: 1, available: "true" },
          { version: 1, tenantId: b.tenantId },
          { version: 0, active: false },
        ]) {
          assert.equal(
            (await req(path(a.siteId, `/products/${p.id}`), "PATCH", body, sa))
              .status,
            400,
          );
        }
        assert.equal(
          (
            await req(
              path(a.siteId, "/tables"),
              "POST",
              { code: "invalid", sectorId: sector.id, capacity: 1, x: 0.1 },
              sa,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/families"),
              "POST",
              { code: "FOOD", name: "Duplicate" },
              sa,
            )
          ).status,
          409,
        );
        const trimmed = await ok("/families", "POST", {
          code: `${" ".repeat(40)}trim`,
          name: `${" ".repeat(81)}Trimmed`,
        });
        assert.equal(trimmed.code, "trim");
        assert.equal(trimmed.name, "Trimmed");
        for (const priceCents of [0, 100000000])
          assert.equal(
            (
              await ok("/products", "POST", {
                code: `boundary_${priceCents}`,
                name: "Boundary",
                familyId: f.id,
                priceCents,
              })
            ).priceCents,
            priceCents,
          );
      },
    );

    await scenario(
      "optimistic stock race commits exactly one adjustment and effective availability follows family",
      async () => {
        const results = await Promise.all(
          [5, 7].map((quantity) =>
            req(
              path(a.siteId, `/products/${p.id}/quantity`),
              "POST",
              { version: p.version, quantity, reason: "Independent race" },
              sa,
            ),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const winner = results.find((r) => r.status === 200)!.data;
        const available = await ok(`/products/${p.id}`, "PATCH", {
          version: winner.version,
          available: true,
        });
        assert.equal(available.effectiveAvailable, true);
        await ok(`/families/${f.id}`, "PATCH", {
          version: f.version,
          active: false,
        });
        const products = (await ok("/products")).items as Row[];
        assert.equal(
          products.find((row) => row.id === p.id)?.effectiveAvailable,
          false,
        );
        const rows = await admin.query(
          "SELECT * FROM restaurant.quantity_adjustments WHERE tenant_id=$1 AND product_id=$2",
          [a.tenantId, p.id],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.previous_quantity, 0);
        for (const quantity of [-1, 1.1, 1000001, "2", null])
          assert.equal(
            (
              await req(
                path(a.siteId, `/products/${p.id}/quantity`),
                "POST",
                { version: available.version, quantity, reason: "Invalid" },
                sa,
              )
            ).status,
            400,
          );
      },
    );

    await scenario(
      "runtime SQL is scoped and composite foreign keys reject tenant/site substitutions",
      async () => {
        for (const relation of [
          "families",
          "products",
          "sectors",
          "dining_tables",
          "attentions",
          "quantity_adjustments",
          "operation_events",
        ]) {
          assert.equal(
            (await runtime.query(`SELECT id FROM restaurant.${relation}`))
              .length,
            0,
          );
          const [rls] = await admin.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [`restaurant.${relation}`],
          );
          assert.equal(rls?.relrowsecurity, true);
          assert.equal(rls?.relforcerowsecurity, true);
        }
        const insert =
          "INSERT INTO restaurant.products(id,tenant_id,site_id,family_id,code,name,price_cents) VALUES($1,$2,$3,$4,'forged','Forged',1)";
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              insert,
              [randomUUID(), b.tenantId, b.siteId, fb.id],
              tx,
            ),
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              insert,
              [randomUUID(), a.tenantId, a.siteId, fb.id],
              tx,
            ),
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              insert,
              [randomUUID(), a.tenantId, secondSite, f.id],
              tx,
            ),
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              "INSERT INTO restaurant.dining_tables(id,tenant_id,site_id,sector_id,code,capacity) VALUES($1,$2,$3,$4,'forged',1)",
              [randomUUID(), a.tenantId, secondSite, sector.id],
              tx,
            ),
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              "INSERT INTO restaurant.attentions(id,tenant_id,site_id,table_id,waiter_id,waiter_name,guests,request_id) VALUES($1,$2,$3,$4,$5,'forged',1,$6)",
              [
                randomUUID(),
                a.tenantId,
                secondSite,
                table.id,
                waiter.id,
                randomUUID(),
              ],
              tx,
            ),
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              "INSERT INTO restaurant.quantity_adjustments(id,tenant_id,site_id,product_id,actor_id,previous_quantity,new_quantity,previous_version,reason) VALUES($1,$2,$3,$4,$5,0,1,1,'forged')",
              [randomUUID(), a.tenantId, secondSite, p.id, a.userId],
              tx,
            ),
          ),
        );
        const own = await runtime.tenant(a.tenantId, (tx) =>
          runtime.query("SELECT tenant_id FROM restaurant.products", [], tx),
        );
        assert.ok(
          own.length > 0 && own.every((row) => row.tenant_id === a.tenantId),
        );
      },
    );

    await scenario(
      "waiters require active user, explicit permission and membership",
      async () => {
        const bad = await user("badwaiter", [], [a.siteId]);
        const inactive = await user("inactivewaiter", ["mesas.operar"]);
        assert.equal(
          (
            await req(
              `/api/users/${inactive.id}`,
              "PATCH",
              { active: false },
              sa,
            )
          ).status,
          200,
        );
        const listed = (await ok("/waiters")).items as Row[];
        assert.ok(listed.some((row) => row.id === waiter.id));
        assert.ok(
          !listed.some((row) =>
            [bad.id, inactive.id, noSite.id].includes(String(row.id)),
          ),
        );
        for (const waiterId of [bad.id, inactive.id, noSite.id, b.userId]) {
          const r = await req(
            path(a.siteId, "/attentions"),
            "POST",
            { requestId: randomUUID(), tableId: table.id, waiterId, guests: 1 },
            sa,
          );
          assert.ok(
            [400, 403, 404].includes(r.status),
            `ineligible waiter accepted: ${r.status}`,
          );
        }
      },
    );

    await scenario(
      "concurrent opens, occupied edit protection, consumption guard and canonical idempotency",
      async () => {
        const bodies = [1, 2].map((guests) => ({
          requestId: randomUUID(),
          tableId: table.id,
          waiterId: waiter.id,
          guests,
        }));
        const opens = await Promise.all(
          bodies.map((body) =>
            req(path(a.siteId, "/attentions"), "POST", body, sa),
          ),
        );
        assert.deepEqual(opens.map((r) => r.status).sort(), [200, 409]);
        const index = opens.findIndex((r) => r.status === 200),
          attention = opens[index]!.data,
          body = bodies[index]!;
        assert.equal(attention.waiterName, "waiter");
        const reordered = {
          guests: body.guests,
          waiterId: body.waiterId,
          tableId: body.tableId,
          requestId: body.requestId,
        };
        assert.equal(
          (await ok("/attentions", "POST", reordered)).id,
          attention.id,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, "/attentions"),
              "POST",
              { ...body, guests: 3 },
              sa,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, `/sectors/${sector.id}`),
              "PATCH",
              { version: sector.version, name: "Occupied" },
              sa,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, `/tables/${table.id}`),
              "PATCH",
              { version: table.version, capacity: 5 },
              sa,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await req(
              path(a.siteId, `/attentions/${attention.id}/cancel`),
              "POST",
              { reason: " " },
              sa,
            )
          ).status,
          400,
        );
        await admin.exec(
          "UPDATE restaurant.attentions SET consumption_count=1 WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, attention.id],
        );
        assert.equal(
          (
            await req(
              path(a.siteId, `/attentions/${attention.id}/cancel`),
              "POST",
              { reason: "Must reject consumption" },
              sa,
            )
          ).status,
          409,
        );
        await admin.exec(
          "UPDATE restaurant.attentions SET consumption_count=0 WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, attention.id],
        );
        const cancelled = await ok(
          `/attentions/${attention.id}/cancel`,
          "POST",
          { reason: "Empty attention cancelled" },
        );
        assert.equal(cancelled.status, "cancelled");
        assert.equal(
          (await ok("/attentions", "POST", reordered)).id,
          attention.id,
        );
        assert.equal(
          (await ok("/attentions", "POST", body)).status,
          "cancelled",
        );
        const tables = (await ok("/tables")).items as Row[];
        assert.equal(tables.find((row) => row.id === table.id)?.state, "free");
        await ok(`/sectors/${sector.id}`, "PATCH", {
          version: sector.version,
          active: false,
        });
        assert.ok(
          [404, 409].includes(
            (
              await req(
                path(a.siteId, "/attentions"),
                "POST",
                { ...body, requestId: randomUUID() },
                sa,
              )
            ).status,
          ),
        );
        assert.equal(
          (await ok("/attentions", "POST", body)).id,
          attention.id,
          "retry must return cancelled original despite inactive sector",
        );
      },
    );

    await scenario(
      "simultaneous identical request IDs create exactly one historical attention",
      async () => {
        const s = await ok("/sectors", "POST", {
          code: "retry",
          name: "Retry",
        });
        const d = await ok("/tables", "POST", {
          code: "retry",
          sectorId: s.id,
          capacity: 1,
        });
        const body = {
          requestId: randomUUID(),
          tableId: d.id,
          waiterId: waiter.id,
          guests: 1,
        };
        const results = await Promise.all([
          req(path(a.siteId, "/attentions"), "POST", body, sa),
          req(path(a.siteId, "/attentions"), "POST", body, sa),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [200, 200],
        );
        assert.equal(results[0]!.data.id, results[1]!.data.id);
        const [count] = await admin.query(
          "SELECT count(*)::int count FROM restaurant.attentions WHERE tenant_id=$1 AND request_id=$2",
          [a.tenantId, body.requestId],
        );
        assert.equal(count?.count, 1);
        const [events] = await admin.query(
          "SELECT count(*)::int count FROM restaurant.operation_events WHERE tenant_id=$1 AND entity_id=$2 AND action='attention.opened'",
          [a.tenantId, results[0]!.data.id],
        );
        assert.equal(events?.count, 1);
      },
    );

    await scenario(
      "audit failure rolls back catalog mutation atomically",
      async () => {
        const original = auth.audit.bind(auth);
        auth.audit = async () => {
          throw Error("independent audit failure");
        };
        try {
          const r = await req(
            path(a.siteId, "/families"),
            "POST",
            { code: "rollback", name: "Must rollback" },
            sa,
          );
          assert.equal(r.status, 500);
          assert.equal(
            (
              await admin.query(
                "SELECT id FROM restaurant.families WHERE tenant_id=$1 AND code='rollback'",
                [a.tenantId],
              )
            ).length,
            0,
          );
          const [before] = await admin.query(
            "SELECT quantity,version FROM restaurant.products WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, p.id],
          );
          const [beforeCount] = await admin.query(
            "SELECT count(*)::int count FROM restaurant.quantity_adjustments WHERE tenant_id=$1",
            [a.tenantId],
          );
          assert.equal(
            (
              await req(
                path(a.siteId, `/products/${p.id}/quantity`),
                "POST",
                {
                  version: before!.version,
                  quantity: 99,
                  reason: "Must rollback",
                },
                sa,
              )
            ).status,
            500,
          );
          const [after] = await admin.query(
            "SELECT quantity,version FROM restaurant.products WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, p.id],
          );
          const [afterCount] = await admin.query(
            "SELECT count(*)::int count FROM restaurant.quantity_adjustments WHERE tenant_id=$1",
            [a.tenantId],
          );
          assert.deepEqual(after, before);
          assert.deepEqual(afterCount, beforeCount);
        } finally {
          auth.audit = original;
        }
      },
    );

    await scenario(
      "new permission catalog preserves legacy administrator definition and blocks escalation",
      async () => {
        assert.equal(PERMISSIONS.length, 9);
        assert.equal(ADMIN_PERMISSIONS.length, 4);
        const legacy = await user("legacyadmin", ADMIN_PERMISSIONS);
        const bootstrapPermissions = (
          await req("/api/context", "GET", undefined, sa)
        ).data.permissions as string[];
        assert.deepEqual(
          [...bootstrapPermissions].sort(),
          [...PERMISSIONS].sort(),
        );
        const r = await req(
          "/api/roles",
          "POST",
          { name: "Forbidden upgrade", permissions: PERMISSIONS },
          legacy.session,
        );
        assert.equal(r.status, 403);
        assert.equal(
          (
            await req(
              `/api/users/${legacy.id}`,
              "PATCH",
              { roleIds: [a.roleId] },
              legacy.session,
            )
          ).status,
          403,
        );
        assert.equal(
          (await req(`/api/users/${a.userId}`, "PATCH", { active: false }, sa))
            .status,
          200,
          "legacy four-permission admin remains an admin",
        );
        assert.equal(
          (
            await req(
              `/api/users/${noSite.id}`,
              "PATCH",
              { active: false },
              noSite.session,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await req(
              `/api/users/${legacy.id}`,
              "PATCH",
              { active: false },
              legacy.session,
            )
          ).status,
          409,
          "last admin uses four original permissions",
        );
      },
    );

    await scenario(
      "authorization rechecked after mutex wait and concurrent revocation",
      async () => {
        // Hold tenant mutex until a waiting API mutation has started, then revoke in the same transaction.
        let release!: () => void, locked!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const acquired = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const txPromise = admin.tenant(a.tenantId, async (tx) => {
          locked();
          await held;
          await admin.exec(
            "UPDATE restaurant.sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2",
            [a.tenantId, waiter.id],
            tx,
          );
        });
        await acquired;
        const mutation = req(
          path(a.siteId, "/attentions"),
          "POST",
          {
            requestId: randomUUID(),
            tableId: table.id,
            waiterId: waiter.id,
            guests: 1,
          },
          waiter.session,
        );
        let waiting = false;
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            const rows = await admin.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='restaurante' AND wait_event_type='Lock' AND query LIKE '%restaurant.tenants%FOR UPDATE%'",
            );
            if (rows.length) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } finally {
          release();
          await txPromise;
        }
        assert.ok(
          waiting,
          "operation must demonstrably wait for tenant mutex before revocation",
        );
        assert.equal((await mutation).status, 401);
      },
    );
    if (failures.length)
      throw new AggregateError(
        failures,
        "Independent operations attacks failed",
      );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
    for (const tenantId of tenants)
      await admin.sql.transaction(async (tx) => {
        for (const relation of [
          "operation_events",
          "quantity_adjustments",
          "attentions",
          "dining_tables",
          "products",
          "sectors",
          "families",
          "audit_events",
          "sessions",
          "user_sites",
          "user_roles",
          "role_permissions",
          "roles",
          "users",
          "sites",
        ])
          await admin.exec(
            `DELETE FROM restaurant.${relation} WHERE tenant_id=$1`,
            [tenantId],
            tx,
          );
        await admin.exec(
          "DELETE FROM restaurant.tenants WHERE id=$1",
          [tenantId],
          tx,
        );
      });
    const keys = [
      "ip:127.0.0.1",
      ...codes.flatMap((code) =>
        [...usernames].map((name) => `identity:${code}:${name}`),
      ),
    ].map((value) => createHmac("sha256", secret).update(value).digest("hex"));
    await admin.exec(
      "DELETE FROM restaurant.auth_events WHERE identity_key=ANY($1::text[])",
      [keys],
    );
    await admin.exec(
      "DELETE FROM restaurant.auth_limits WHERE key=ANY($1::text[])",
      [keys],
    );
    await admin.close();
  }
});
