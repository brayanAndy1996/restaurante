import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database, AuthService } from "../src/auth.js";
import { AuthError, PERMISSIONS, hashToken } from "../src/auth-policy.js";
import { bootstrap } from "../scripts/bootstrap-tenant.js";
import { migrate, assertDedicated } from "../scripts/db-migrate.js";
const runtimeUrl = process.env.TEST_DATABASE_URL,
  adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!runtimeUrl || !adminUrl)
  throw new Error(
    "Integration requires explicit TEST_DATABASE_URL and TEST_ADMIN_DATABASE_URL; no skipped tests",
  );
assertDedicated(runtimeUrl, "test");
assertDedicated(adminUrl, "test");
if (new URL(runtimeUrl).username === new URL(adminUrl).username)
  throw new Error("Separate runtime and migration credentials required");
const secret = `${process.env.AUTH_HMAC_SECRET ?? ""}:${randomUUID()}`;
const password = "Fictitious-test-password2026!";
async function expectCode(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(
    fn,
    (e: unknown) => e instanceof AuthError && e.code === code,
  );
}
test("PostgreSQL real: restricted roles, isolation, lifecycle and durable invariants", async (t) => {
  await migrate(adminUrl, "test");
  await migrate(adminUrl, "test");
  const admin = new Database(adminUrl),
    runtime = new Database(runtimeUrl),
    auth = new AuthService(runtime, secret);
  await auth.initialize();
  const scenario = async (name: string, fn: () => Promise<void>) => {
    await fn();
    t.diagnostic(name);
  };
  const suffix = randomUUID().slice(0, 8),
    codeA = `test-a-${suffix}`,
    codeB = `test-b-${suffix}`;
  try {
    const a = await bootstrap(admin, {
      code: codeA,
      name: "Test A",
      siteCode: "main",
      siteName: "Principal",
      username: "admin",
      password,
    });
    const b = await bootstrap(admin, {
      code: codeB,
      name: "Test B",
      siteCode: "main",
      siteName: "Principal",
      username: "admin",
      password,
    });
    const login = await auth.login(
        { tenantCode: codeA, username: "admin", password },
        "127.0.0.1",
      ),
      loginB = await auth.login(
        { tenantCode: codeB, username: "admin", password },
        "127.0.0.2",
      );
    const ia = await auth.identify(login.token),
      ib = await auth.identify(loginB.token);
    const route = (i: typeof ia, method: string, path: string, body = {}) =>
      auth.authorized(i, undefined, (tr) =>
        auth.route(
          method,
          path,
          body,
          i,
          tr,
          new URL(`http://localhost${path}`),
        ),
      );
    await scenario(
      "runtime rejects incomplete migration while missing marker rolls back",
      async () => {
        const rollback = new Error("rollback marker fixture");
        await assert.rejects(
          () =>
            admin.sql.transaction(async (tr) => {
              await admin.exec(
                "DELETE FROM restaurant.metadata WHERE key='patch003'",
                [],
                tr,
              );
              await admin.exec("SET LOCAL ROLE restaurante_runtime", [], tr);
              await assert.rejects(
                () => admin.verifyRuntime(tr),
                /Migration required/,
              );
              throw rollback;
            }),
          (error) => error === rollback,
        );
        await runtime.verifyRuntime();
      },
    );
    await scenario(
      "bootstrap repetition and injected failure never reset or leave partial tenant",
      async () => {
        await assert.rejects(() =>
          bootstrap(admin, {
            code: codeA,
            name: "Changed",
            siteCode: "main",
            siteName: "Main",
            username: "admin",
            password: "Different-password2026!",
          }),
        );
        const failCode = `fail-${suffix}`;
        await assert.rejects(() =>
          bootstrap(admin, {
            code: failCode,
            name: "Fail",
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
              [failCode],
            )
          ).length,
          0,
        );
      },
    );
    await scenario(
      "runtime role rejects ownership escalation, grants and unscoped SQL",
      async () => {
        await runtime.verifyRuntime();
        assert.equal(
          (await runtime.query("SELECT id FROM restaurant.users")).length,
          0,
        );
        await assert.rejects(() =>
          runtime.exec(
            "ALTER TABLE restaurant.users DISABLE ROW LEVEL SECURITY",
          ),
        );
        await assert.rejects(() =>
          runtime.exec("SET ROLE restaurante_auth_lookup"),
        );
        const tables = await admin.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='restaurant' AND c.relname IN('tenants','users','sites','roles','sessions','audit_events','user_roles','role_permissions','user_sites')",
        );
        assert.equal(tables.length, 9);
        assert.ok(
          tables.every((r) => r.relrowsecurity && r.relforcerowsecurity),
        );
        await assert.rejects(() => new AuthService(admin, secret).initialize());
      },
    );
    await scenario(
      "A cannot read or mutate B; composite foreign keys reject crossed references",
      async () => {
        const context = await auth.authorized(ia, undefined, (tr) =>
          auth.context(ia, tr),
        );
        assert.equal(context.tenant.id, a.tenantId);
        assert.ok(context.permissions.length === 4);
        await expectCode(
          () => route(ia, "PATCH", `/api/users/${b.userId}`, { active: false }),
          "NOT_FOUND",
        );
        await assert.rejects(() =>
          runtime.tenant(a.tenantId, (tr) =>
            runtime.exec(
              "INSERT INTO restaurant.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
              [a.tenantId, a.userId, b.roleId],
              tr,
            ),
          ),
        );
      },
    );
    await scenario(
      "small pooled concurrent transactions and rollback do not leak scope",
      async () => {
        await Promise.all(
          Array.from({ length: 24 }, async (_, index) => {
            const tenantId = index % 2 ? a.tenantId : b.tenantId;
            await runtime.tenant(tenantId, async (tr) => {
              const rows = await runtime.query(
                "SELECT DISTINCT tenant_id FROM restaurant.users",
                [],
                tr,
              );
              assert.equal(rows.length, 1);
              assert.equal(rows[0]?.tenant_id, tenantId);
            });
          }),
        );
        await assert.rejects(() =>
          runtime.tenant(a.tenantId, async () => {
            throw Error("rollback");
          }),
        );
        assert.equal(
          (await runtime.query("SELECT id FROM restaurant.users")).length,
          0,
        );
      },
    );
    await scenario("tokens are hashed and CSRF bound to session", async () => {
      const [stored] = await admin.query(
        "SELECT token_hash FROM restaurant.sessions WHERE id=$1",
        [ia.sessionId],
      );
      assert.equal(stored?.token_hash, hashToken(login.token));
      assert.notEqual(stored?.token_hash, login.token);
      assert.throws(() => auth.csrf(ia, ib.csrf), AuthError);
      auth.csrf(ia, ia.csrf);
    });
    await scenario(
      "limited users cannot grant roles or take over privileged accounts",
      async () => {
        const managerRole = (await route(ia, "POST", "/api/roles", {
          name: `Manager ${suffix}`,
          permissions: ["usuarios.gestionar"],
        })) as { id: string };
        const managerUser = (await route(ia, "POST", "/api/users", {
          username: "manager",
          password,
          roleIds: [managerRole.id],
        })) as { id: string };
        const managerLogin = await auth.login(
            { tenantCode: codeA, username: "manager", password },
            "127.0.0.3",
          ),
          im = await auth.identify(managerLogin.token);
        await expectCode(
          () =>
            route(im, "PATCH", `/api/users/${managerUser.id}`, {
              roleIds: [a.roleId],
            }),
          "FORBIDDEN",
        );
        await expectCode(
          () =>
            route(im, "POST", `/api/users/${a.userId}/password`, {
              password: "Takeover-password2026!",
            }),
          "FORBIDDEN",
        );
        await expectCode(
          () => route(im, "PATCH", `/api/users/${a.userId}`, { active: false }),
          "FORBIDDEN",
        );
        await expectCode(() => route(im, "GET", "/api/roles"), "FORBIDDEN");
        await expectCode(
          () =>
            route(im, "PATCH", `/api/users/${managerUser.id}`, {
              siteIds: [a.siteId],
            }),
          "FORBIDDEN",
        );
      },
    );
    await scenario(
      "durable concurrent rate limit blocks sixth attempt and records no plaintext identity",
      async () => {
        const bad = {
          tenantCode: codeA,
          username: `missing-${suffix}`,
          password,
        };
        const results = await Promise.allSettled(
          Array.from({ length: 12 }, () => auth.login(bad, "127.0.0.4")),
        );
        assert.equal(
          results.filter(
            (r) =>
              r.status === "rejected" &&
              r.reason.code === "INVALID_CREDENTIALS",
          ).length,
          5,
        );
        assert.equal(
          results.filter(
            (r) => r.status === "rejected" && r.reason.code === "RATE_LIMITED",
          ).length,
          7,
        );
        const keys = await admin.query(
          "SELECT key FROM restaurant.auth_limits",
        );
        assert.ok(keys.every((r) => /^[a-f0-9]{64}$/.test(String(r.key))));
      },
    );
    await scenario("audit failure rolls user creation back", async () => {
      await admin.exec(
        "CREATE FUNCTION restaurant.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected audit failure''; END'; CREATE TRIGGER test_audit_failure BEFORE INSERT ON restaurant.audit_events FOR EACH ROW WHEN (NEW.tenant_id = '" +
          a.tenantId +
          "'::uuid) EXECUTE FUNCTION restaurant.test_audit_failure()",
      );
      try {
        await assert.rejects(() =>
          route(ia, "POST", "/api/users", { username: "rolledback", password }),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM restaurant.users WHERE tenant_id=$1 AND username='rolledback'",
              [a.tenantId],
            )
          ).length,
          0,
        );
      } finally {
        await admin.exec(
          "DROP TRIGGER test_audit_failure ON restaurant.audit_events; DROP FUNCTION restaurant.test_audit_failure()",
        );
      }
    });
    await scenario(
      "last admin and concurrent role edits are protected",
      async () => {
        await expectCode(
          () => route(ia, "PATCH", `/api/users/${a.userId}`, { active: false }),
          "LAST_ADMIN",
        );
        const outcomes = await Promise.allSettled([
          route(ia, "PATCH", `/api/roles/${a.roleId}`, { permissions: [] }),
          route(ia, "PATCH", `/api/users/${a.userId}`, { roleIds: [] }),
        ]);
        assert.ok(
          outcomes.every(
            (r) => r.status === "rejected" && r.reason.code === "LAST_ADMIN",
          ),
        );
        assert.deepEqual(
          [
            ...(await auth.authorized(ia, undefined, (tr) =>
              auth.permissions(a.userId, tr),
            )),
          ].sort(),
          [...PERMISSIONS].sort(),
        );
      },
    );
    await scenario(
      "site administrator can enumerate tenant catalog without operational membership",
      async () => {
        await admin.exec(
          "DELETE FROM restaurant.user_sites WHERE tenant_id=$1 AND user_id=$2",
          [a.tenantId, a.userId],
        );
        const context = await auth.authorized(ia, undefined, (tr) =>
          auth.context(ia, tr),
        );
        assert.equal(context.sites.length, 0);
        const catalog = (await route(ia, "GET", "/api/sites")) as {
          items: { id: string }[];
        };
        assert.deepEqual(
          catalog.items.map((r) => r.id),
          [a.siteId],
        );
      },
    );
    await scenario(
      "revocation password change, expiration and activity timeout enforced",
      async () => {
        const l2 = await auth.login(
            { tenantCode: codeA, username: "admin", password },
            "127.0.0.5",
          ),
          i2 = await auth.identify(l2.token);
        await route(ia, "POST", "/api/auth/password", {
          currentPassword: password,
          newPassword: "Changed-test-password2026!",
        });
        await expectCode(() => auth.identify(login.token), "AUTH_REQUIRED");
        await expectCode(() => auth.identify(l2.token), "AUTH_REQUIRED");
        await expectCode(
          () => route(i2, "GET", "/api/context"),
          "AUTH_REQUIRED",
        );
        await admin.exec(
          "UPDATE restaurant.sessions SET last_seen=now()-interval '31 minutes' WHERE id=$1",
          [ib.sessionId],
        );
        await expectCode(() => auth.identify(loginB.token), "AUTH_REQUIRED");
      },
    );
  } finally {
    await runtime.close();
    for (const code of [codeA, codeB]) {
      const [tenant] = await admin.query(
        "SELECT id FROM restaurant.tenants WHERE code=$1",
        [code],
      );
      if (!tenant) continue;
      await admin.sql.transaction(async (tr) => {
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
            [tenant.id],
            tr,
          );
        }
        await admin.exec(
          "DELETE FROM restaurant.tenants WHERE id=$1",
          [tenant.id],
          tr,
        );
      });
    }
    await admin.close();
  }
});
