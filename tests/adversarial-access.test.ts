import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database, AuthService } from "../src/auth.js";
import { PERMISSIONS } from "../src/auth-policy.js";
import { bootstrap } from "../scripts/bootstrap-tenant.js";
import { assertDedicated } from "../scripts/db-migrate.js";
import { createHttpServer } from "../src/server.js";

// Independent fixtures: no migration/reset/TRUNCATE, and no demo credentials.
test("independent adversarial access regression on dedicated PostgreSQL", async (t) => {
  const failures: Error[] = [];
  async function scenario(name: string, run: () => Promise<void>) {
    try {
      await run();
      t.diagnostic(`PASS ${name}`);
    } catch (error) {
      failures.push(new Error(name, { cause: error }));
      t.diagnostic(`FAIL ${name}`);
    }
  }
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  assert.ok(
    runtimeUrl && adminUrl,
    "Explicit isolated PostgreSQL test credentials required",
  );
  assertDedicated(runtimeUrl, "test");
  assertDedicated(adminUrl, "test");
  const admin = new Database(adminUrl);
  const runtime = new Database(runtimeUrl);
  // One dedicated server key per run keeps durable rate buckets isolated from other suites.
  const testSecret = randomBytes(32).toString("hex");
  const auth = new AuthService(runtime, testSecret);
  const [marker] = await admin.query(
    "SELECT value FROM restaurant.metadata WHERE key='environment'",
  );
  assert.equal(
    marker?.value,
    "test",
    "Never attack a database without the test marker",
  );
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const password = `Test-access-${suffix}!`;
  const fixtureCodes = [`adv_a_${suffix}`, `adv_b_${suffix}`];
  const tenantIds: string[] = [];
  const staticRoot = await mkdtemp(join(tmpdir(), "restaurant-adversarial-"));
  await writeFile(join(staticRoot, "index.html"), "Adversarial fixture");
  const origin = "http://127.0.0.1:3000";
  const server = await createHttpServer(
    { mode: "cloud", host: "127.0.0.1", port: 3000 },
    { auth, origin, staticRoot },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  type Session = { cookie: string; csrf: string };
  async function request(
    path: string,
    method = "GET",
    input?: object,
    session?: Session,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(input ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...extra,
      },
      body: input ? JSON.stringify(input) : undefined,
    });
    const data = (await response.json()) as Record<string, unknown>;
    return { response, data };
  }
  async function login(code: string, username = "admin"): Promise<Session> {
    const { response, data } = await request("/api/auth/login", "POST", {
      tenantCode: code,
      username,
      password,
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return { cookie, csrf: String(data.csrfToken) };
  }
  async function createRole(
    session: Session,
    name: string,
    permissions: readonly string[],
  ): Promise<string> {
    const result = await request(
      "/api/roles",
      "POST",
      { name, permissions },
      session,
    );
    assert.equal(result.response.status, 200);
    return String(result.data.id);
  }
  try {
    await auth.initialize();
    const fixtures = [];
    for (const code of fixtureCodes) {
      const fixture = await bootstrap(admin, {
        code,
        name: "Independent test",
        siteCode: "main",
        siteName: "Main",
        username: "admin",
        password,
      });
      tenantIds.push(fixture.tenantId);
      fixtures.push(fixture);
    }
    const a = fixtures[0]!;
    const b = fixtures[1]!;
    const sa = await login(fixtureCodes[0]!);
    const sb = await login(fixtureCodes[1]!);

    await scenario(
      "bootstrap rollback and repetition cannot replace an existing account",
      async () => {
        const code = `adv_fail_${suffix}`;
        await assert.rejects(
          bootstrap(admin, {
            code,
            name: "Rollback fixture",
            siteCode: "main",
            siteName: "Main",
            username: "admin",
            password,
            failAfterUser: true,
          }),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM restaurant.tenants WHERE code=$1",
              [code],
            )
          ).length,
          0,
        );
        const [before] = await admin.query(
          "SELECT password_hash FROM restaurant.users WHERE id=$1",
          [a.userId],
        );
        await assert.rejects(
          bootstrap(admin, {
            code: fixtureCodes[0]!,
            name: "Overwrite attempt",
            siteCode: "main",
            siteName: "Main",
            username: "admin",
            password: `${password}changed`,
          }),
        );
        const [after] = await admin.query(
          "SELECT password_hash FROM restaurant.users WHERE id=$1",
          [a.userId],
        );
        assert.ok(
          before?.password_hash === after?.password_hash,
          "bootstrap must not reset existing credentials",
        );
      },
    );

    await scenario(
      "RLS denies absent scope and cross-tenant relations; pooled rollback clears scope",
      async () => {
        assert.equal(
          (await runtime.query("SELECT id FROM restaurant.users")).length,
          0,
        );
        await assert.rejects(
          runtime.exec(
            "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$2,'forged')",
            [randomUUID(), a.tenantId],
          ),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, (tx) =>
            runtime.exec(
              "INSERT INTO restaurant.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
              [a.tenantId, a.userId, b.roleId],
              tx,
            ),
          ),
        );
        await Promise.all(
          Array.from({ length: 16 }, async (_, index) => {
            const fixture = index % 2 ? a : b;
            await runtime.tenant(fixture.tenantId, async (tx) => {
              const users = await runtime.query(
                "SELECT tenant_id FROM restaurant.users",
                [],
                tx,
              );
              assert.ok(
                users.length > 0 &&
                  users.every((u) => u.tenant_id === fixture.tenantId),
              );
            });
          }),
        );
        await assert.rejects(
          runtime.tenant(a.tenantId, async (tx) => {
            await runtime.query("SELECT id FROM restaurant.users", [], tx);
            throw Error("intentional rollback");
          }),
        );
        assert.equal(
          (await runtime.query("SELECT id FROM restaurant.users")).length,
          0,
        );
        const roles = await admin.query(
          "SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb FROM pg_roles r WHERE rolname='restaurante_runtime'",
        );
        assert.ok(Object.values(roles[0]!).every((value) => value === false));
        const functions = await admin.query(
          "SELECT p.proname,p.prosecdef,p.proconfig,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='restaurant'",
        );
        assert.ok(functions.length >= 4);
        assert.ok(
          functions.every(
            (f) =>
              f.prosecdef &&
              !f.public_execute &&
              String(f.proconfig).includes(
                "search_path=pg_catalog, restaurant",
              ),
          ),
        );
      },
    );

    await scenario(
      "manipulated identifiers and forged tenant headers cannot expose or change B",
      async () => {
        const list = await request("/api/users", "GET", undefined, sa, {
          "X-Tenant-Id": b.tenantId,
        });
        assert.equal(list.response.status, 200);
        assert.ok(
          !(list.data.items as Array<{ id: string }>).some(
            (u) => u.id === b.userId,
          ),
        );
        assert.equal(
          (
            await request(
              `/api/users/${b.userId}`,
              "PATCH",
              { active: false },
              sa,
            )
          ).response.status,
          404,
        );
        assert.equal(
          (
            await request(
              `/api/users/${a.userId}`,
              "PATCH",
              { tenantId: b.tenantId },
              sa,
            )
          ).response.status,
          400,
        );
        assert.equal(
          (
            await request(
              `/api/users/${a.userId}`,
              "PATCH",
              { roleIds: [b.roleId] },
              sa,
            )
          ).response.status,
          404,
        );
        assert.equal(
          (
            await request(
              `/api/users/${a.userId}`,
              "PATCH",
              { siteIds: [b.siteId] },
              sa,
            )
          ).response.status,
          404,
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, sb)).response.status,
          200,
        );
      },
    );

    await scenario(
      "CSRF, token fixation, rejected origin and logout revocation",
      async () => {
        const session = await login(fixtureCodes[0]!);
        assert.equal(
          (
            await request("/api/auth/logout", "POST", {}, session, {
              Origin: "https://attacker.invalid",
            })
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request("/api/auth/logout", "POST", {}, session, {
              "X-CSRF-Token": "forged",
            })
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request("/api/auth/logout", "POST", {}, session, {
              "X-CSRF-Token": "é".repeat(43),
            })
          ).response.status,
          403,
          "malformed multibyte CSRF must not throw a server error",
        );
        const fixed = await request(
          "/api/auth/login",
          "POST",
          { tenantCode: fixtureCodes[0], username: "admin", password },
          undefined,
          { Cookie: "restaurant_session=attacker" },
        );
        assert.equal(fixed.response.status, 200);
        assert.ok(
          !fixed.response.headers.get("set-cookie")?.includes("=attacker;"),
        );
        const logout = await request("/api/auth/logout", "POST", {}, session);
        assert.equal(logout.response.status, 200);
        assert.equal(
          (await request("/api/context", "GET", undefined, session)).response
            .status,
          401,
        );
        assert.equal(
          (await request("/api/auth/logout", "POST", {}, session)).response
            .status,
          200,
          "logout retry must remain idempotent",
        );
      },
    );

    await scenario(
      "limited managers cannot self-promote or reset a more privileged user",
      async () => {
        const role = await createRole(sa, "Only user management", [
          "usuarios.gestionar",
        ]);
        const user = await request(
          "/api/users",
          "POST",
          { username: "limited", password, roleIds: [role], siteIds: [] },
          sa,
        );
        assert.equal(user.response.status, 200);
        const limited = await login(fixtureCodes[0]!, "limited");
        assert.equal(
          (
            await request(
              `/api/users/${user.data.id}`,
              "PATCH",
              { roleIds: [a.roleId] },
              limited,
            )
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request(
              `/api/users/${a.userId}/password`,
              "POST",
              { password },
              limited,
            )
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request(
              `/api/users/${a.userId}`,
              "PATCH",
              { active: false },
              limited,
            )
          ).response.status,
          403,
        );
        const limitedRole = await createRole(sa, "Role manager subset", [
          "usuarios.gestionar",
          "roles.gestionar",
        ]);
        const roleManager = await request(
          "/api/users",
          "POST",
          {
            username: "rolemanager",
            password,
            roleIds: [limitedRole],
            siteIds: [],
          },
          sa,
        );
        assert.equal(roleManager.response.status, 200);
        const manager = await login(fixtureCodes[0]!, "rolemanager");
        assert.equal(
          (
            await request(
              "/api/roles",
              "POST",
              { name: "Escalated", permissions: PERMISSIONS },
              manager,
            )
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request(
              `/api/roles/${a.roleId}`,
              "PATCH",
              { name: "Captured admin" },
              manager,
            )
          ).response.status,
          403,
        );
        const elevatedCreate = await request(
          "/api/users",
          "POST",
          { username: "overprivileged", password, roleIds: [a.roleId] },
          manager,
        );
        const elevatedSelf = await request(
          `/api/users/${roleManager.data.id}`,
          "PATCH",
          { roleIds: [a.roleId] },
          manager,
        );
        assert.deepEqual(
          [elevatedCreate.response.status, elevatedSelf.response.status],
          [403, 403],
          "a role manager must not assign an existing role stronger than their own permissions, on creation or update",
        );
      },
    );

    await scenario(
      "tenant mutex preserves the last admin under concurrent requests",
      async () => {
        const actor = await login(fixtureCodes[1]!);
        const created = await request(
          "/api/users",
          "POST",
          {
            username: "admin2",
            password,
            roleIds: [b.roleId],
            siteIds: [b.siteId],
          },
          actor,
        );
        assert.equal(created.response.status, 200);
        const actor2 = await login(fixtureCodes[1]!, "admin2");
        const results = await Promise.all([
          request(`/api/users/${b.userId}`, "PATCH", { active: false }, actor),
          request(
            `/api/users/${created.data.id}`,
            "PATCH",
            { active: false },
            actor2,
          ),
        ]);
        assert.deepEqual(
          results.map((r) => r.response.status).sort(),
          [200, 409],
        );
        const [remaining] = await admin.query(
          "SELECT count(*)::int count FROM restaurant.users WHERE tenant_id=$1 AND active",
          [b.tenantId],
        );
        assert.equal(remaining?.count, 1);
      },
    );

    await scenario(
      "password reset revokes every previous session",
      async () => {
        const role = await createRole(sa, "No privileges", []);
        const created = await request(
          "/api/users",
          "POST",
          { username: "reset_target", password, roleIds: [role], siteIds: [] },
          sa,
        );
        assert.equal(created.response.status, 200);
        const target1 = await login(fixtureCodes[0]!, "reset_target");
        const target2 = await login(fixtureCodes[0]!, "reset_target");
        assert.equal(
          (
            await request(
              `/api/users/${created.data.id}/password`,
              "POST",
              { password: `${password}new` },
              sa,
            )
          ).response.status,
          200,
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, target1)).response
            .status,
          401,
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, target2)).response
            .status,
          401,
        );
        const [stored] = await admin.query(
          "SELECT password_hash FROM restaurant.users WHERE id=$1",
          [created.data.id],
        );
        assert.ok(String(stored?.password_hash).startsWith("$argon2id$"));
        assert.ok(
          !JSON.stringify(
            (await request("/api/audit", "GET", undefined, sa)).data,
          ).includes(String(stored?.password_hash)),
        );
      },
    );

    await scenario(
      "audit failure rolls back an administrative mutation",
      async () => {
        // Inject only this server's audit adapter; avoid global database DDL/triggers.
        const originalAudit = auth.audit.bind(auth);
        auth.audit = async () => {
          throw Error("independent injected audit persistence failure");
        };
        try {
          const result = await request(
            "/api/roles",
            "POST",
            { name: "Must rollback", permissions: [] },
            sa,
          );
          assert.equal(result.response.status, 500);
          const rows = await admin.query(
            "SELECT id FROM restaurant.roles WHERE tenant_id=$1 AND name='Must rollback'",
            [a.tenantId],
          );
          assert.equal(rows.length, 0);
        } finally {
          auth.audit = originalAudit;
        }
      },
    );

    await scenario(
      "idle and absolute expiry, local membership and active tenant are checked again",
      async () => {
        const created = await request(
          "/api/users",
          "POST",
          {
            username: "expiry_target",
            password,
            roleIds: [],
            siteIds: [a.siteId],
          },
          sa,
        );
        assert.equal(created.response.status, 200);
        const idle = await login(fixtureCodes[0]!, "expiry_target");
        await admin.exec(
          "UPDATE restaurant.sessions SET last_seen=now()-interval '31 minutes' WHERE user_id=$1",
          [created.data.id],
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, idle)).response
            .status,
          401,
        );
        const absolute = await login(fixtureCodes[0]!, "expiry_target");
        await admin.exec(
          "UPDATE restaurant.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [created.data.id],
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, absolute)).response
            .status,
          401,
        );
        const membership = await login(fixtureCodes[0]!, "expiry_target");
        await admin.exec(
          "DELETE FROM restaurant.user_sites WHERE tenant_id=$1 AND user_id=$2",
          [a.tenantId, created.data.id],
        );
        assert.deepEqual(
          (await request("/api/context", "GET", undefined, membership)).data
            .sites,
          [],
        );
        await admin.exec(
          "UPDATE restaurant.tenants SET active=false WHERE id=$1",
          [a.tenantId],
        );
        assert.equal(
          (await request("/api/context", "GET", undefined, membership)).response
            .status,
          401,
        );
        await admin.exec(
          "UPDATE restaurant.tenants SET active=true WHERE id=$1",
          [a.tenantId],
        );
      },
    );

    await scenario(
      "five simultaneous invalid credentials exhaust the durable identity budget",
      async () => {
        const username = `missing_${suffix}`;
        const failures = await Promise.all(
          Array.from({ length: 12 }, () =>
            request("/api/auth/login", "POST", {
              tenantCode: fixtureCodes[0],
              username,
              password: "Incorrect-password-long!",
            }),
          ),
        );
        assert.equal(
          failures.filter((f) => f.response.status === 401).length,
          5,
          "exactly five failed verifications allowed on this fresh identity window, including concurrent requests",
        );
        assert.equal(
          failures.filter((f) => f.response.status === 429).length,
          7,
        );
      },
    );

    await scenario(
      "closed database cannot authorize cached sessions",
      async () => {
        await runtime.close();
        assert.equal(await auth.ready(), false);
        const result = await request("/api/context", "GET", undefined, sa);
        assert.ok([500, 503].includes(result.response.status));
        assert.ok(!("user" in result.data));
      },
    );
    if (failures.length)
      throw new AggregateError(
        failures,
        "Independent adversarial scenarios failed",
      );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
    // Delete exclusively the random tenant fixture rows, never shared test/demo data.
    for (const tenantId of tenantIds) {
      await admin.sql.transaction(async (tx) => {
        for (const table of [
          "audit_events",
          "sessions",
          "user_sites",
          "user_roles",
          "role_permissions",
          "roles",
          "users",
          "sites",
        ]) {
          await admin.exec(
            `DELETE FROM restaurant.${table} WHERE tenant_id=$1`,
            [tenantId],
            tx,
          );
        }
        await admin.exec(
          "DELETE FROM restaurant.tenants WHERE id=$1",
          [tenantId],
          tx,
        );
      });
    }
    const bucketInputs = [
      "ip:127.0.0.1",
      ...fixtureCodes.flatMap((code) =>
        [
          "admin",
          "limited",
          "rolemanager",
          "reset_target",
          "expiry_target",
          `missing_${suffix}`,
        ].map((username) => `identity:${code}:${username}`),
      ),
    ];
    const bucketKeys = bucketInputs.map((value) =>
      createHmac("sha256", testSecret).update(value).digest("hex"),
    );
    await admin.exec(
      "DELETE FROM restaurant.auth_events WHERE identity_key=ANY($1::text[])",
      [bucketKeys],
    );
    await admin.exec(
      "DELETE FROM restaurant.auth_limits WHERE key=ANY($1::text[])",
      [bucketKeys],
    );
    await admin.close();
    await rm(staticRoot, { recursive: true, force: true });
  }
});
