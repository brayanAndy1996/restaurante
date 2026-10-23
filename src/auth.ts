import { Sequelize, QueryTypes, type Transaction } from "sequelize";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as argon2 from "argon2";
import {
  AuthError,
  PERMISSIONS,
  fields,
  hashToken,
  ids,
  normalizeIdentifier,
  opaqueToken,
  text,
  validatePassword,
} from "./auth-policy.js";
export type Row = Record<string, unknown>;
export const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export async function hashPassword(password: unknown): Promise<string> {
  return argon2.hash(validatePassword(password), ARGON_OPTIONS);
}
export class Database {
  readonly sql: Sequelize;
  constructor(url: string) {
    if (!url.startsWith("postgres")) throw new Error("PostgreSQL required");
    this.sql = new Sequelize(url, {
      logging: false,
      pool: { max: 4, min: 0, idle: 10000 },
      dialectOptions: { application_name: "restaurante" },
    });
  }
  async query<T extends Row = Row>(
    sql: string,
    bind: unknown[] = [],
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.sql.query<T>(sql, {
      bind,
      transaction,
      type: QueryTypes.SELECT,
    });
  }
  async exec(
    sql: string,
    bind: unknown[] = [],
    transaction?: Transaction,
  ): Promise<void> {
    await this.sql.query(sql, {
      ...(bind.length ? { bind } : {}),
      transaction,
    });
  }
  async tenant<T>(
    tenantId: string,
    fn: (t: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.sql.transaction(async (t) => {
      await this.query(
        "SELECT set_config('restaurant.tenant_id',$1,true)",
        [tenantId],
        t,
      );
      await this.query(
        "SELECT id FROM restaurant.tenants WHERE id=$1 FOR UPDATE",
        [tenantId],
        t,
      );
      return fn(t);
    });
  }
  async verifyRuntime(transaction?: Transaction): Promise<void> {
    const [r] = await this.query(
      `SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='restaurant' AND c.relowner=r.oid) owns,
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='restaurant' AND n.nspowner=r.oid) owns_schema,
      EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=r.oid) owns_database,
      EXISTS(SELECT 1 FROM pg_roles p WHERE p.oid<>r.oid AND pg_has_role(current_user,p.oid,'MEMBER') AND
        (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb OR p.rolname='restaurante_auth_lookup'
         OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='restaurant' AND c.relowner=p.oid)
         OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='restaurant' AND n.nspowner=p.oid)
         OR EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=p.oid))) privileged_membership
      FROM pg_roles r WHERE r.rolname=current_user`,
      [],
      transaction,
    );
    if (!r || Object.values(r).some(Boolean))
      throw new Error("Unsafe runtime PostgreSQL role");
    const [m] = await this.query(
      "SELECT value FROM restaurant.metadata WHERE key='version'",
      [],
      transaction,
    );
    if (m?.value !== "002") throw new Error("Migration required");
    const [patch] = await this.query(
      "SELECT value FROM restaurant.metadata WHERE key='patch003'",
      [],
      transaction,
    );
    if (patch?.value !== "logout-idempotent")
      throw new Error("Migration required");
  }
  close() {
    return this.sql.close();
  }
}
export interface SessionIdentity {
  tenantId: string;
  userId: string;
  sessionId: string;
  csrf: string;
}
export class AuthService {
  private dummy = "";
  constructor(
    readonly db: Database,
    private readonly hmacSecret: string,
  ) {
    if (Buffer.byteLength(hmacSecret) < 32)
      throw new Error("AUTH_HMAC_SECRET must contain at least 32 bytes");
  }
  async initialize() {
    await this.db.verifyRuntime();
    this.dummy = await hashPassword(opaqueToken());
  }
  private key(value: string) {
    return createHmac("sha256", this.hmacSecret).update(value).digest("hex");
  }
  async ready(): Promise<boolean> {
    try {
      await this.db.verifyRuntime();
      return true;
    } catch {
      return false;
    }
  }
  async audit(
    t: Transaction,
    tenant: string,
    actor: string | null,
    action: string,
    entity: string | null,
    outcome = "success",
  ) {
    await this.db.exec(
      "INSERT INTO restaurant.audit_events(id,tenant_id,actor_id,action,entity_id,outcome) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), tenant, actor, action, entity, outcome],
      t,
    );
  }
  async login(body: Row, ip: string) {
    fields(body, ["tenantCode", "username", "password"]);
    const tenantCode = normalizeIdentifier(body.tenantCode),
      username = normalizeIdentifier(body.username);
    const password = validatePassword(body.password);
    const identityKey = this.key(`identity:${tenantCode}:${username}`),
      ipKey = this.key(`ip:${ip}`);
    const [ipRate] = await this.db.query(
      "SELECT restaurant.rate_attempt($1,100,true) allowed",
      [ipKey],
    );
    const [rate] = await this.db.query(
      "SELECT restaurant.rate_attempt($1,5,true) allowed",
      [identityKey],
    );
    if (!ipRate?.allowed || !rate?.allowed)
      throw new AuthError("RATE_LIMITED", 429);
    const [identity] = await this.db.query(
      "SELECT * FROM restaurant.login_identity($1,$2)",
      [tenantCode, username],
    );
    const valid = await argon2.verify(
      String(identity?.password_hash ?? this.dummy),
      password,
    );
    if (!identity || !valid) {
      await this.db.query("SELECT restaurant.record_auth($1,'failed')", [
        identityKey,
      ]);
      throw new AuthError("INVALID_CREDENTIALS", 401);
    }
    await this.db.query("SELECT restaurant.rate_success($1)", [identityKey]);
    return this.db.tenant(String(identity.tenant_id), async (t) => {
      const [u] = await this.db.query(
        "SELECT u.id FROM restaurant.users u JOIN restaurant.tenants te ON te.id=u.tenant_id WHERE u.id=$1 AND u.active AND te.active AND u.password_hash=$2",
        [identity.user_id, identity.password_hash],
        t,
      );
      if (!u) throw new AuthError("INVALID_CREDENTIALS", 401);
      const token = opaqueToken(),
        csrf = opaqueToken(),
        sessionId = randomUUID();
      await this.db.exec(
        "INSERT INTO restaurant.sessions(id,tenant_id,user_id,token_hash,csrf_token) VALUES($1,$2,$3,$4,$5)",
        [sessionId, identity.tenant_id, u.id, hashToken(token), csrf],
        t,
      );
      await this.audit(
        t,
        String(identity.tenant_id),
        String(u.id),
        "auth.login",
        String(u.id),
      );
      return {
        token,
        context: await this.context(
          {
            tenantId: String(identity.tenant_id),
            userId: String(u.id),
            sessionId,
            csrf,
          },
          t,
        ),
      };
    });
  }
  async logoutProof(token: string, csrf: string | undefined): Promise<boolean> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !csrf ||
      !/^[A-Za-z0-9_-]{43}$/.test(csrf)
    )
      return false;
    const [proof] = await this.db.query(
      "SELECT restaurant.logout_proof($1,$2) valid",
      [hashToken(token), csrf],
    );
    return proof?.valid === true;
  }
  async identify(token: string | undefined): Promise<SessionIdentity> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError("AUTH_REQUIRED", 401);
    const [s] = await this.db.query(
      "SELECT * FROM restaurant.session_identity($1)",
      [hashToken(token)],
    );
    if (!s) throw new AuthError("AUTH_REQUIRED", 401);
    return {
      tenantId: String(s.tenant_id),
      userId: String(s.user_id),
      sessionId: String(s.session_id),
      csrf: String(s.csrf_token),
    };
  }
  async authorized<T>(
    identity: SessionIdentity,
    permission: string | undefined,
    fn: (t: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.db.tenant(identity.tenantId, async (t) => {
      const [s] = await this.db.query(
        "SELECT s.id FROM restaurant.sessions s JOIN restaurant.users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id JOIN restaurant.tenants te ON te.id=s.tenant_id WHERE s.id=$1 AND s.user_id=$2 AND NOT s.revoked AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND u.active AND te.active FOR UPDATE OF s",
        [identity.sessionId, identity.userId],
        t,
      );
      if (!s) throw new AuthError("AUTH_REQUIRED", 401);
      if (
        permission &&
        !(await this.permissions(identity.userId, t)).includes(permission)
      )
        throw new AuthError("FORBIDDEN", 403);
      await this.db.exec(
        "UPDATE restaurant.sessions SET last_seen=now() WHERE id=$1",
        [identity.sessionId],
        t,
      );
      return fn(t);
    });
  }
  async permissions(userId: string, t: Transaction): Promise<string[]> {
    const rows = await this.db.query(
      "SELECT DISTINCT rp.permission FROM restaurant.user_roles ur JOIN restaurant.role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.user_id=$1 ORDER BY rp.permission",
      [userId],
      t,
    );
    return rows.map((r) => String(r.permission));
  }
  async context(i: SessionIdentity, t: Transaction) {
    const [u] = await this.db.query(
      "SELECT id,username,active FROM restaurant.users WHERE id=$1",
      [i.userId],
      t,
    );
    const [tenant] = await this.db.query(
      "SELECT id,code,name FROM restaurant.tenants WHERE id=$1",
      [i.tenantId],
      t,
    );
    const sites = await this.db.query(
      "SELECT s.id,s.code,s.name,s.active FROM restaurant.sites s JOIN restaurant.user_sites us ON us.site_id=s.id AND us.tenant_id=s.tenant_id WHERE us.user_id=$1 AND s.active ORDER BY s.code",
      [i.userId],
      t,
    );
    return {
      user: u,
      tenant,
      sites,
      permissions: await this.permissions(i.userId, t),
      csrfToken: i.csrf,
    };
  }
  csrf(i: SessionIdentity, token: string | undefined) {
    if (
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      Buffer.byteLength(token) !== Buffer.byteLength(i.csrf) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(i.csrf))
    )
      throw new AuthError("FORBIDDEN", 403);
  }
  async ensureAdmin(t: Transaction) {
    const [row] = await this.db.query(
      "SELECT count(*)::int count FROM (SELECT u.id FROM restaurant.users u JOIN restaurant.user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id JOIN restaurant.role_permissions rp ON rp.role_id=ur.role_id AND rp.tenant_id=ur.tenant_id WHERE u.active GROUP BY u.id HAVING count(DISTINCT rp.permission)=4) admins",
      [],
      t,
    );
    if (Number(row?.count) < 1) throw new AuthError("LAST_ADMIN", 409);
  }
  async assignments(
    userId: string,
    tenantId: string,
    body: Row,
    t: Transaction,
    allowedPermissions: string[],
  ) {
    if (body.roleIds !== undefined) {
      const roleIds = ids(body.roleIds);
      for (const id of roleIds) {
        if (
          !(
            await this.db.query(
              "SELECT id FROM restaurant.roles WHERE id=$1",
              [id],
              t,
            )
          ).length
        )
          throw new AuthError("NOT_FOUND", 404);
        const granted = await this.db.query(
          "SELECT permission FROM restaurant.role_permissions WHERE role_id=$1",
          [id],
          t,
        );
        if (
          granted.some(
            (p) => !allowedPermissions.includes(String(p.permission)),
          )
        )
          throw new AuthError("FORBIDDEN", 403);
      }
      await this.db.exec(
        "DELETE FROM restaurant.user_roles WHERE user_id=$1",
        [userId],
        t,
      );
      for (const id of roleIds)
        await this.db.exec(
          "INSERT INTO restaurant.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
          [tenantId, userId, id],
          t,
        );
    }
    if (body.siteIds !== undefined) {
      const siteIds = ids(body.siteIds);
      for (const id of siteIds) {
        if (
          !(
            await this.db.query(
              "SELECT id FROM restaurant.sites WHERE id=$1 AND active",
              [id],
              t,
            )
          ).length
        )
          throw new AuthError("NOT_FOUND", 404);
      }
      await this.db.exec(
        "DELETE FROM restaurant.user_sites WHERE user_id=$1",
        [userId],
        t,
      );
      for (const id of siteIds)
        await this.db.exec(
          "INSERT INTO restaurant.user_sites(tenant_id,user_id,site_id) VALUES($1,$2,$3)",
          [tenantId, userId, id],
          t,
        );
    }
  }
  async route(
    method: string,
    path: string,
    body: Row,
    i: SessionIdentity,
    t: Transaction,
    url: URL,
  ): Promise<object> {
    if (method === "GET" && path === "/api/context") return this.context(i, t);
    if (method === "GET" && path === "/api/permissions")
      return { items: PERMISSIONS };
    if (method === "GET" && path === "/api/sites")
      return {
        items: (await this.permissions(i.userId, t)).includes("locales.asignar")
          ? await this.db.query(
              "SELECT id,code,name,active FROM restaurant.sites WHERE active ORDER BY code",
              [],
              t,
            )
          : (await this.context(i, t)).sites,
      };
    if (method === "POST" && path === "/api/auth/logout") {
      fields(body, []);
      await this.db.exec(
        "UPDATE restaurant.sessions SET revoked=true WHERE id=$1",
        [i.sessionId],
        t,
      );
      await this.audit(t, i.tenantId, i.userId, "auth.logout", i.userId);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/auth/password") {
      fields(body, ["currentPassword", "newPassword"]);
      const [u] = await this.db.query(
        "SELECT password_hash FROM restaurant.users WHERE id=$1",
        [i.userId],
        t,
      );
      if (
        !(await argon2.verify(
          String(u?.password_hash),
          validatePassword(body.currentPassword),
        ))
      )
        throw new AuthError("INVALID_CREDENTIALS", 401);
      await this.db.exec(
        "UPDATE restaurant.users SET password_hash=$1 WHERE id=$2",
        [await hashPassword(body.newPassword), i.userId],
        t,
      );
      await this.db.exec(
        "UPDATE restaurant.sessions SET revoked=true WHERE user_id=$1",
        [i.userId],
        t,
      );
      await this.audit(t, i.tenantId, i.userId, "auth.password", i.userId);
      return { ok: true };
    }
    const permissions = await this.permissions(i.userId, t);
    const required = path.startsWith("/api/users")
      ? "usuarios.gestionar"
      : path.startsWith("/api/roles")
        ? "roles.gestionar"
        : path === "/api/audit"
          ? "auditoria.consultar"
          : undefined;
    if (required && !permissions.includes(required))
      throw new AuthError("FORBIDDEN", 403);
    if (method === "GET" && path === "/api/users")
      return {
        items: await this.db.query(
          'SELECT u.id,u.username,u.active,ARRAY(SELECT ur.role_id FROM restaurant.user_roles ur WHERE ur.user_id=u.id) "roleIds",ARRAY(SELECT us.site_id FROM restaurant.user_sites us WHERE us.user_id=u.id) "siteIds" FROM restaurant.users u ORDER BY u.username LIMIT 1000',
          [],
          t,
        ),
      };
    if (method === "GET" && path === "/api/roles")
      return {
        items: await this.db.query(
          "SELECT r.id,r.name,ARRAY(SELECT rp.permission FROM restaurant.role_permissions rp WHERE rp.role_id=r.id ORDER BY rp.permission) permissions FROM restaurant.roles r ORDER BY r.name LIMIT 1000",
          [],
          t,
        ),
      };
    if (method === "GET" && path === "/api/audit") {
      const limit = Number(url.searchParams.get("limit") ?? 50),
        offset = Number(url.searchParams.get("offset") ?? 0);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 100000
      )
        throw new AuthError("VALIDATION_ERROR");
      const action = url.searchParams.get("action");
      return {
        items: await this.db.query(
          'SELECT id,action,entity_id "entityId",actor_id "actorId",created_at "createdAt",outcome FROM restaurant.audit_events WHERE ($3::text IS NULL OR action=$3) ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
          [limit, offset, action],
          t,
        ),
        limit,
        offset,
      };
    }
    const userMatch =
      /^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/password)?$/.exec(
        path,
      );
    if (
      (method === "POST" && path === "/api/users") ||
      (userMatch && (method === "PATCH" || (method === "POST" && userMatch[2])))
    ) {
      const create = path === "/api/users",
        reset = Boolean(userMatch?.[2]);
      fields(
        body,
        reset
          ? ["password"]
          : create
            ? ["username", "password", "roleIds", "siteIds"]
            : ["active", "roleIds", "siteIds"],
      );
      const userId = create ? randomUUID() : userMatch![1]!;
      if (
        body.roleIds !== undefined &&
        !permissions.includes("roles.gestionar")
      )
        throw new AuthError("FORBIDDEN", 403);
      if (!create) {
        const targetPermissions = await this.permissions(userId, t);
        if (targetPermissions.some((p) => !permissions.includes(p)))
          throw new AuthError("FORBIDDEN", 403);
      }
      if (
        body.siteIds !== undefined &&
        !permissions.includes("locales.asignar")
      )
        throw new AuthError("FORBIDDEN", 403);
      if (create) {
        const [count] = await this.db.query(
          "SELECT count(*)::int count FROM restaurant.users",
          [],
          t,
        );
        if (Number(count?.count) >= 1000) throw new AuthError("CONFLICT", 409);
        await this.db.exec(
          "INSERT INTO restaurant.users(id,tenant_id,username,password_hash) VALUES($1,$2,$3,$4)",
          [
            userId,
            i.tenantId,
            normalizeIdentifier(body.username),
            await hashPassword(body.password),
          ],
          t,
        );
      } else if (
        !(
          await this.db.query(
            "SELECT id FROM restaurant.users WHERE id=$1",
            [userId],
            t,
          )
        ).length
      )
        throw new AuthError("NOT_FOUND", 404);
      if (reset && userId === i.userId) throw new AuthError("FORBIDDEN", 403);
      if (reset)
        await this.db.exec(
          "UPDATE restaurant.users SET password_hash=$1 WHERE id=$2",
          [await hashPassword(body.password), userId],
          t,
        );
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AuthError("VALIDATION_ERROR");
        await this.db.exec(
          "UPDATE restaurant.users SET active=$1 WHERE id=$2",
          [body.active, userId],
          t,
        );
      }
      await this.assignments(userId, i.tenantId, body, t, permissions);
      await this.ensureAdmin(t);
      if (!create)
        await this.db.exec(
          "UPDATE restaurant.sessions SET revoked=true WHERE user_id=$1",
          [userId],
          t,
        );
      await this.audit(
        t,
        i.tenantId,
        i.userId,
        create ? "users.create" : reset ? "users.password" : "users.update",
        userId,
      );
      return { id: userId };
    }
    const roleMatch =
      /^\/api\/roles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
        path,
      );
    if (
      (method === "POST" && path === "/api/roles") ||
      (method === "PATCH" && roleMatch)
    ) {
      fields(body, ["name", "permissions"]);
      if (
        body.permissions !== undefined &&
        (!Array.isArray(body.permissions) ||
          body.permissions.some((p) => !permissions.includes(String(p))))
      )
        throw new AuthError("FORBIDDEN", 403);
      const create = path === "/api/roles",
        roleId = create ? randomUUID() : roleMatch![1]!;
      if (!create) {
        const existing = await this.db.query(
          "SELECT permission FROM restaurant.role_permissions WHERE role_id=$1",
          [roleId],
          t,
        );
        if (existing.some((p) => !permissions.includes(String(p.permission))))
          throw new AuthError("FORBIDDEN", 403);
      }
      if (create) {
        const [count] = await this.db.query(
          "SELECT count(*)::int count FROM restaurant.roles",
          [],
          t,
        );
        if (Number(count?.count) >= 1000) throw new AuthError("CONFLICT", 409);
        await this.db.exec(
          "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$2,$3)",
          [roleId, i.tenantId, text(body.name)],
          t,
        );
      } else {
        if (
          !(
            await this.db.query(
              "SELECT id FROM restaurant.roles WHERE id=$1",
              [roleId],
              t,
            )
          ).length
        )
          throw new AuthError("NOT_FOUND", 404);
        if (body.name !== undefined)
          await this.db.exec(
            "UPDATE restaurant.roles SET name=$1 WHERE id=$2",
            [text(body.name), roleId],
            t,
          );
      }
      if (body.permissions !== undefined) {
        if (
          !Array.isArray(body.permissions) ||
          body.permissions.some(
            (p) => !PERMISSIONS.includes(p as (typeof PERMISSIONS)[number]),
          )
        )
          throw new AuthError("VALIDATION_ERROR");
        await this.db.exec(
          "DELETE FROM restaurant.role_permissions WHERE role_id=$1",
          [roleId],
          t,
        );
        for (const p of new Set(body.permissions))
          await this.db.exec(
            "INSERT INTO restaurant.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,$3)",
            [i.tenantId, roleId, p],
            t,
          );
      }
      await this.ensureAdmin(t);
      await this.db.exec(
        "UPDATE restaurant.sessions SET revoked=true WHERE user_id IN(SELECT user_id FROM restaurant.user_roles WHERE role_id=$1)",
        [roleId],
        t,
      );
      await this.audit(
        t,
        i.tenantId,
        i.userId,
        create ? "roles.create" : "roles.update",
        roleId,
      );
      return { id: roleId };
    }
    throw new AuthError("NOT_FOUND", 404);
  }
}
