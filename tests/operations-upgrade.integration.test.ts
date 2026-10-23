import { seedDemoData, seedDemo } from "../scripts/seed-demo.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Database, AuthService } from "../src/auth.js";
import {
  AuthError,
  ADMIN_PERMISSIONS,
  PERMISSIONS,
} from "../src/auth-policy.js";
import { migrate, assertDedicated } from "../scripts/db-migrate.js";
import { bootstrap } from "../scripts/bootstrap-tenant.js";
const source = process.env.TEST_ADMIN_DATABASE_URL!,
  runtimeSource = process.env.TEST_DATABASE_URL!;
assertDedicated(source, "test");
assertDedicated(runtimeSource, "test");
test("upgrade002 to004 preserves scoped administrators and shared limited roles", async (t) => {
  const sourceUrl = new URL(source);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname));
  assert.equal(sourceUrl.port, "55432");
  const name = `restaurante_test_upgrade_${randomUUID().replaceAll("-", "")}`;
  assert(/^restaurante_test_upgrade_[a-f0-9]{32}$/.test(name));
  const manager = new Database(source);
  let created = false,
    db: Database | undefined,
    rt: Database | undefined;
  const [owner] = await manager.query("SELECT current_user name");
  const ownerName = String(owner!.name);
  try {
    assert.equal(
      (
        await manager.query(
          "SELECT datname FROM pg_database WHERE datname=$1",
          [name],
        )
      ).length,
      0,
    );
    await manager.exec(`CREATE DATABASE ${name}`);
    created = true;
    t.diagnostic(`Created isolated fixture ${name}; owner ${ownerName}`);
    sourceUrl.pathname = `/${name}`;
    const uri = sourceUrl.toString();
    db = new Database(uri);
    await db.exec(await readFile("migrations/002-access.sql", "utf8"));
    await db.exec(await readFile("migrations/003-logout-proof.sql", "utf8"));
    const tenant = randomUUID(),
      site = randomUUID(),
      adminId = randomUUID(),
      limited = randomUUID(),
      inactive = randomUUID(),
      sharedRole = randomUUID(),
      restRole = randomUUID();
    await db.exec(
      "INSERT INTO restaurant.tenants(id,code,name) VALUES($1,'upgrade','Upgrade')",
      [tenant],
    );
    await db.exec(
      "INSERT INTO restaurant.sites(id,tenant_id,code,name) VALUES($1,$2,'main','Main')",
      [site, tenant],
    );
    for (const [id, username, active] of [
      [adminId, "admin", true],
      [limited, "limited", true],
      [inactive, "inactive", false],
    ])
      await db.exec(
        "INSERT INTO restaurant.users(id,tenant_id,username,password_hash,active) VALUES($1,$2,$3,$4,$5)",
        [id, tenant, username, "unusable-fixture-hash", active],
      );
    await db.exec(
      "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$3,'Shared user manager'),($2,$3,'Remaining administration')",
      [sharedRole, restRole, tenant],
    );
    await db.exec(
      "INSERT INTO restaurant.role_permissions VALUES($1,$2,'usuarios.gestionar')",
      [tenant, sharedRole],
    );
    for (const p of ADMIN_PERMISSIONS.filter((p) => p !== "usuarios.gestionar"))
      await db.exec(
        "INSERT INTO restaurant.role_permissions VALUES($1,$2,$3)",
        [tenant, restRole, p],
      );
    for (const id of [adminId, limited, inactive]) {
      await db.exec("INSERT INTO restaurant.user_roles VALUES($1,$2,$3)", [
        tenant,
        id,
        sharedRole,
      ]);
      await db.exec("INSERT INTO restaurant.user_sites VALUES($1,$2,$3)", [
        tenant,
        id,
        site,
      ]);
      if (id !== limited)
        await db.exec("INSERT INTO restaurant.user_roles VALUES($1,$2,$3)", [
          tenant,
          id,
          restRole,
        ]);
      await db.exec(
        "INSERT INTO restaurant.sessions(id,tenant_id,user_id,token_hash,csrf_token) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), tenant, id, randomUUID(), randomUUID()],
      );
    }
    await migrate(uri);
    await migrate(uri);
    const perms = async (id: string) =>
      (
        await db!.query(
          "SELECT DISTINCT rp.permission FROM restaurant.user_roles ur JOIN restaurant.role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.user_id=$1 ORDER BY rp.permission",
          [id],
        )
      ).map((r) => String(r.permission));
    assert.deepEqual(await perms(adminId), [...PERMISSIONS].sort());
    assert.deepEqual(await perms(limited), ["usuarios.gestionar"]);
    assert.deepEqual(await perms(inactive), [...ADMIN_PERMISSIONS].sort());
    const [shared] = await db.query(
      "SELECT count(*)::int n FROM restaurant.role_permissions WHERE role_id=$1",
      [sharedRole],
    );
    assert.equal(shared!.n, 1);
    const sessions = await db.query(
      "SELECT user_id,revoked FROM restaurant.sessions",
    );
    assert.equal(sessions.find((s) => s.user_id === adminId)!.revoked, true);
    assert.equal(sessions.find((s) => s.user_id === limited)!.revoked, false);
    assert.equal(
      (
        await db.query(
          "SELECT id FROM restaurant.audit_events WHERE action='permissions.upgrade004'",
        )
      ).length,
      1,
    );
    const boot = await bootstrap(db, {
      code: "fresh",
      name: "Fresh installation",
      siteCode: "main",
      siteName: "Main",
      username: "admin",
      password: "Upgrade-test-password2026!",
    });
    const ru = new URL(runtimeSource);
    ru.pathname = `/${name}`;
    rt = new Database(ru.toString());
    const auth = new AuthService(
      rt,
      "upgrade-test-secret-at-least32characters",
    );
    await auth.initialize();
    const login = await auth.login(
      {
        tenantCode: "fresh",
        username: "admin",
        password: "Upgrade-test-password2026!",
      },
      "upgrade-test",
    );
    assert.deepEqual(login.context.permissions, [...PERMISSIONS].sort());
    const identity = await auth.identify(login.token);
    await assert.rejects(
      () =>
        auth.authorized(identity, undefined, (tr) =>
          auth.route(
            "PATCH",
            `/api/users/${boot.userId}`,
            { active: false },
            identity,
            tr,
            new URL("http://localhost"),
          ),
        ),
      (e: unknown) => e instanceof AuthError && e.code === "LAST_ADMIN",
    );
  } finally {
    if (rt) await rt.close();
    if (db) await db.close();
    if (created) {
      const [row] = await manager.query(
        "SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=$1",
        [name],
      );
      assert.equal(row?.owner, ownerName);
      await manager.exec(`DROP DATABASE ${name}`);
      t.diagnostic(`Removed fixture ${name}`);
    }
    await manager.close();
  }
});

test("demo from empty and manual edits reject without overwriting isolated fixture", async (t) => {
  const sourceUrl = new URL(source);
  assert.equal(sourceUrl.port, "55432");
  const name = `restaurante_test_upgrade_${randomUUID().replaceAll("-", "")}`;
  assert(/^restaurante_test_upgrade_[a-f0-9]{32}$/.test(name));
  const manager = new Database(source);
  const [owner] = await manager.query("SELECT current_user name");
  let created = false,
    db: Database | undefined;
  try {
    assert.equal(
      (
        await manager.query(
          "SELECT datname FROM pg_database WHERE datname=$1",
          [name],
        )
      ).length,
      0,
    );
    await manager.exec(`CREATE DATABASE ${name}`);
    created = true;
    t.diagnostic(`Created empty demo fixture ${name}; owner ${owner!.name}`);
    sourceUrl.pathname = `/${name}`;
    await migrate(sourceUrl.toString());
    db = new Database(sourceUrl.toString());
    await assert.rejects(
      () => seedDemo(sourceUrl.toString()),
      /Dedicated loopback restaurante_demo/,
    );
    await db.exec(
      "UPDATE restaurant.metadata SET value='demo' WHERE key='environment'",
    );
    const seed = () => db!.sql.transaction((tr) => seedDemoData(db!, tr));
    await seed();
    await seed();
    const [counts] = await db.query(
      "SELECT (SELECT count(*)::int FROM restaurant.tenants) tenants,(SELECT count(*)::int FROM restaurant.products) products,(SELECT count(*)::int FROM restaurant.dining_tables) tables,(SELECT count(*)::int FROM restaurant.users) users",
    );
    assert.deepEqual(counts, { tenants: 2, products: 3, tables: 3, users: 8 });
    const products = await db.query(
      "SELECT id,quantity FROM restaurant.products ORDER BY quantity",
    );
    assert.deepEqual(
      products.map((p) => p.quantity),
      [3, 5, 12],
    );
    const product = products[0]!;
    await db.exec(
      "UPDATE restaurant.products SET quantity=quantity+1 WHERE id=$1",
      [product.id],
    );
    await assert.rejects(seed, /Demo operations manually modified/);
    const [changed] = await db.query(
      "SELECT quantity FROM restaurant.products WHERE id=$1",
      [product.id],
    );
    assert.equal(changed!.quantity, 4);
    await db.exec("UPDATE restaurant.products SET quantity=$1 WHERE id=$2", [
      product.quantity,
      product.id,
    ]);
    await seed();
    await db.exec(
      "UPDATE restaurant.tenants SET name='Manual change' WHERE code='demo-a'",
    );
    await assert.rejects(seed, /Demo manually modified/);
    const [manual] = await db.query(
      "SELECT name FROM restaurant.tenants WHERE code='demo-a'",
    );
    assert.equal(manual!.name, "Manual change");
  } finally {
    if (db) await db.close();
    if (created) {
      const [r] = await manager.query(
        "SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=$1",
        [name],
      );
      assert.equal(r?.owner, owner!.name);
      await manager.exec(`DROP DATABASE ${name}`);
      t.diagnostic(`Removed fixture ${name}`);
    }
    await manager.close();
  }
});
