import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import type { AuthService, Row, SessionIdentity } from "./auth.js";
import { AuthError, fields, ids, text } from "./auth-policy.js";
function integer(v: unknown, min: number, max: number): number {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > max)
    throw new AuthError("VALIDATION_ERROR");
  return Number(v);
}
function uuid(v: unknown): string {
  return ids([v])[0]!;
}
function trimmed(v: unknown, max = 80): string {
  return text(typeof v === "string" ? v.trim() : v, max);
}
function code(v: unknown): string {
  const value = trimmed(v, 32).toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(value))
    throw new AuthError("VALIDATION_ERROR");
  return value;
}
function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw new AuthError("VALIDATION_ERROR");
  return v;
}
const sqlTables = {
  families: "families",
  products: "products",
  sectors: "sectors",
  tables: "dining_tables",
} as const;
const base = {
  families: ["code", "name", "active"],
  products: ["code", "name", "familyId", "priceCents", "active", "available"],
  sectors: ["code", "name", "active"],
  tables: ["code", "sectorId", "capacity", "x", "y", "active"],
} as const;
const columns: Record<string, string> = {
  familyId: "family_id",
  priceCents: "price_cents",
  sectorId: "sector_id",
};
function attention(r: Row): Row {
  return {
    id: r.id,
    tableId: r.table_id,
    waiterId: r.waiter_id,
    waiterName: r.waiter_name,
    guests: r.guests,
    requestId: r.request_id,
    status: r.status,
    openedAt: r.opened_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}
export async function operationsRoute(
  auth: AuthService,
  method: string,
  path: string,
  body: Row,
  i: SessionIdentity,
  t: Transaction,
): Promise<object> {
  const parts = path.split("/");
  if (parts.length < 6 || parts[3] !== "sites")
    throw new AuthError("NOT_FOUND", 404);
  const site = uuid(parts[4]),
    kind = parts[5]!,
    id = parts[6] === undefined ? undefined : uuid(parts[6]),
    action = parts[7];
  if (parts.length > 8) throw new AuthError("NOT_FOUND", 404);
  const db = auth.db;
  const q = (s: string, b: unknown[] = []) => db.query(s, b, t),
    e = (s: string, b: unknown[] = []) => db.exec(s, b, t);
  const [membership] = await q(
    "SELECT s.id FROM restaurant.sites s JOIN restaurant.user_sites us ON us.tenant_id=s.tenant_id AND us.site_id=s.id WHERE s.id=$1 AND s.active AND us.user_id=$2",
    [site, i.userId],
  );
  if (!membership) throw new AuthError("NOT_FOUND", 404);
  const permissions = await auth.permissions(i.userId, t);
  const need = (...ps: string[]) => {
    if (!ps.some((p) => permissions.includes(p)))
      throw new AuthError("FORBIDDEN", 403);
  };
  const audit = async (event: string, entity: string, details: Row = {}) => {
    await e(
      "INSERT INTO restaurant.operation_events(id,tenant_id,site_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        randomUUID(),
        i.tenantId,
        site,
        i.userId,
        event,
        entity,
        JSON.stringify(details),
      ],
    );
    await auth.audit(t, i.tenantId, i.userId, event, entity);
  };
  const waiters = () =>
    q(
      "SELECT u.id,u.username FROM restaurant.users u JOIN restaurant.user_sites us ON us.tenant_id=u.tenant_id AND us.user_id=u.id WHERE u.active AND us.site_id=$1 AND EXISTS(SELECT 1 FROM restaurant.user_roles ur JOIN restaurant.role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.user_id=u.id AND ur.tenant_id=u.tenant_id AND rp.permission='mesas.operar') ORDER BY u.username",
      [site],
    );
  const list = async (k: keyof typeof sqlTables) => {
    const table = sqlTables[k];
    if (k === "products")
      return (
        await q(
          "SELECT p.*,f.active family_active FROM restaurant.products p JOIN restaurant.families f ON f.tenant_id=p.tenant_id AND f.site_id=p.site_id AND f.id=p.family_id WHERE p.site_id=$1 ORDER BY p.code",
          [site],
        )
      ).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        active: r.active,
        version: r.version,
        familyId: r.family_id,
        priceCents: r.price_cents,
        available: r.available,
        quantity: r.quantity,
        effectiveAvailable: Boolean(
          r.active && r.family_active && r.available && Number(r.quantity) > 0,
        ),
      }));
    if (k === "tables") {
      const rows = await q(
        "SELECT * FROM restaurant.dining_tables WHERE site_id=$1 ORDER BY code",
        [site],
      );
      const current = await q(
        "SELECT * FROM restaurant.attentions WHERE site_id=$1 AND status='active'",
        [site],
      );
      return rows.map((r) => {
        const a = current.find((v) => v.table_id === r.id);
        return {
          id: r.id,
          code: r.code,
          sectorId: r.sector_id,
          capacity: r.capacity,
          x: r.x,
          y: r.y,
          active: r.active,
          version: r.version,
          state: a ? "occupied" : "free",
          attention: a ? attention(a) : null,
        };
      });
    }
    return q(
      `SELECT id,code,name,active,version FROM restaurant.${table} WHERE site_id=$1 ORDER BY code`,
      [site],
    );
  };
  if (kind === "waiters" && method === "GET" && !id) {
    need("mesas.operar");
    return { items: await waiters() };
  }
  if (kind === "attentions") {
    need("mesas.operar");
    if (method === "POST" && !id) {
      fields(body, ["requestId", "tableId", "waiterId", "guests"]);
      const request = uuid(body.requestId),
        table = uuid(body.tableId),
        waiter = uuid(body.waiterId),
        guests = integer(body.guests, 1, 100);
      const [prior] = await q(
        "SELECT * FROM restaurant.attentions WHERE site_id=$1 AND request_id=$2",
        [site, request],
      );
      if (prior) {
        if (
          prior.table_id !== table ||
          prior.waiter_id !== waiter ||
          prior.guests !== guests
        )
          throw new AuthError("CONFLICT", 409);
        return attention(prior);
      }
      const [tableRow] = await q(
        "SELECT d.* FROM restaurant.dining_tables d JOIN restaurant.sectors s ON s.tenant_id=d.tenant_id AND s.site_id=d.site_id AND s.id=d.sector_id WHERE d.site_id=$1 AND d.id=$2 AND d.active AND s.active FOR UPDATE OF d",
        [site, table],
      );
      if (!tableRow) throw new AuthError("NOT_FOUND", 404);
      if (guests > Number(tableRow.capacity))
        throw new AuthError("VALIDATION_ERROR");
      const w = (await waiters()).find((r) => r.id === waiter);
      if (!w) throw new AuthError("VALIDATION_ERROR");
      if (
        (
          await q(
            "SELECT id FROM restaurant.attentions WHERE site_id=$1 AND table_id=$2 AND status='active'",
            [site, table],
          )
        ).length
      )
        throw new AuthError("CONFLICT", 409);
      const entity = randomUUID();
      await e(
        "INSERT INTO restaurant.attentions(id,tenant_id,site_id,table_id,waiter_id,waiter_name,guests,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [entity, i.tenantId, site, table, waiter, w.username, guests, request],
      );
      await audit("attention.opened", entity, {
        tableId: table,
        waiterId: waiter,
        guests,
        requestId: request,
      });
      return attention(
        (
          await q("SELECT * FROM restaurant.attentions WHERE id=$1", [entity])
        )[0]!,
      );
    }
    if (method === "POST" && id && action === "cancel") {
      fields(body, ["reason"]);
      const reason = trimmed(body.reason, 240);
      const [r] = await q(
        "SELECT * FROM restaurant.attentions WHERE site_id=$1 AND id=$2 FOR UPDATE",
        [site, id],
      );
      if (!r) throw new AuthError("NOT_FOUND", 404);
      if (r.status !== "active" || r.consumption_count !== 0)
        throw new AuthError("CONFLICT", 409);
      await e(
        "UPDATE restaurant.attentions SET status='cancelled',cancelled_at=now(),cancel_reason=$1 WHERE id=$2",
        [reason, id],
      );
      await audit("attention.cancelled", id, { reason });
      return attention(
        (await q("SELECT * FROM restaurant.attentions WHERE id=$1", [id]))[0]!,
      );
    }
    throw new AuthError("METHOD_NOT_ALLOWED", 405);
  }
  if (!Object.hasOwn(sqlTables, kind)) throw new AuthError("NOT_FOUND", 404);
  const k = kind as keyof typeof sqlTables,
    table = sqlTables[k];
  if (method === "GET" && !id) {
    if (k === "families" || k === "products") need("carta.consultar");
    else need("carta.consultar", "mesas.operar", "salon.gestionar");
    return { items: await list(k) };
  }
  if (method === "POST" && k === "products" && id && action === "quantity") {
    need("stock.ajustar");
    fields(body, ["version", "quantity", "reason"]);
    const version = integer(body.version, 1, 2147483646),
      quantity = integer(body.quantity, 0, 1000000),
      reason = trimmed(body.reason, 240);
    const [p] = await q(
      "SELECT * FROM restaurant.products WHERE site_id=$1 AND id=$2 FOR UPDATE",
      [site, id],
    );
    if (!p) throw new AuthError("NOT_FOUND", 404);
    if (p.version !== version) throw new AuthError("CONFLICT", 409);
    await e(
      "UPDATE restaurant.products SET quantity=$1,version=version+1 WHERE id=$2",
      [quantity, id],
    );
    await e(
      "INSERT INTO restaurant.quantity_adjustments(id,tenant_id,site_id,product_id,actor_id,previous_quantity,new_quantity,previous_version,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        i.tenantId,
        site,
        id,
        i.userId,
        p.quantity,
        quantity,
        version,
        reason,
      ],
    );
    await audit("product.quantity", id, {
      previousQuantity: p.quantity,
      quantity,
      version,
      reason,
    });
    return (await list(k)).find((p) => p.id === id)!;
  }
  need(
    k === "families" || k === "products"
      ? "carta.gestionar"
      : "salon.gestionar",
  );
  if (
    action ||
    !["POST", "PATCH"].includes(method) ||
    (method === "PATCH" && !id) ||
    (method === "POST" && id)
  )
    throw new AuthError("METHOD_NOT_ALLOWED", 405);
  const create = method === "POST";
  fields(
    body,
    create
      ? base[k].filter((f) => !["active", "available"].includes(f))
      : ["version", ...base[k]],
  );
  if (create) {
    for (const f of k === "tables"
      ? ["code", "sectorId", "capacity"]
      : k === "products"
        ? ["code", "name", "familyId", "priceCents"]
        : ["code", "name"])
      if (body[f] === undefined) throw new AuthError("VALIDATION_ERROR");
  } else integer(body.version, 1, 2147483646);
  const values: Row = {};
  for (const f of base[k])
    if (body[f] !== undefined) {
      const v = body[f];
      values[columns[f] ?? f] =
        f === "code"
          ? code(v)
          : f === "name"
            ? trimmed(v)
            : f === "active" || f === "available"
              ? boolean(v)
              : f === "familyId" || f === "sectorId"
                ? uuid(v)
                : f === "priceCents"
                  ? integer(v, 0, 100000000)
                  : f === "capacity"
                    ? integer(v, 1, 100)
                    : v === null
                      ? null
                      : integer(v, 0, 10000);
    }
  if (!Object.keys(values).length) throw new AuthError("VALIDATION_ERROR");
  if (values.family_id || values.sector_id) {
    const target = values.family_id ? "families" : "sectors",
      ref = values.family_id ?? values.sector_id;
    const [r] = await q(
      `SELECT id FROM restaurant.${target} WHERE site_id=$1 AND id=$2 AND active`,
      [site, ref],
    );
    if (!r) throw new AuthError("NOT_FOUND", 404);
  }
  let entity = id;
  if (!create) {
    const [r] = await q(
      `SELECT * FROM restaurant.${table} WHERE site_id=$1 AND id=$2 FOR UPDATE`,
      [site, id],
    );
    if (!r) throw new AuthError("NOT_FOUND", 404);
    if (r.version !== body.version) throw new AuthError("CONFLICT", 409);
    if (k === "sectors" || k === "tables") {
      const occupied = await q(
        `SELECT a.id FROM restaurant.attentions a JOIN restaurant.dining_tables d ON d.tenant_id=a.tenant_id AND d.site_id=a.site_id AND d.id=a.table_id WHERE a.site_id=$1 AND a.status='active' AND ${k === "tables" ? "d.id" : "d.sector_id"}=$2`,
        [site, id],
      );
      if (occupied.length) throw new AuthError("CONFLICT", 409);
    }
    const entries = Object.entries(values);
    await e(
      `UPDATE restaurant.${table} SET ${entries.map(([key], n) => `${key}=$${n + 1}`).join(",")},version=version+1 WHERE id=$${entries.length + 1}`,
      [...entries.map(([, v]) => v), id],
    );
  } else {
    entity = randomUUID();
    const entries = Object.entries(values);
    await e(
      `INSERT INTO restaurant.${table}(id,tenant_id,site_id,${entries.map(([key]) => key).join(",")}) VALUES(${[entity, i.tenantId, site, ...entries.map(([, v]) => v)].map((_, n) => `$${n + 1}`).join(",")})`,
      [entity, i.tenantId, site, ...entries.map(([, v]) => v)],
    );
  }
  await audit(`${k}.${create ? "created" : "updated"}`, entity!, {
    fields: Object.keys(values),
  });
  return (await list(k)).find((r) => r.id === entity)!;
}
