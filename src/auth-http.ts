import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService, Row } from "./auth.js";
import { AuthError } from "./auth-policy.js";
function json(res: ServerResponse, status: number, value: object) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<Row> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AuthError("VALIDATION_ERROR");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 16384) throw new AuthError("VALIDATION_ERROR", 413);
    chunks.push(Buffer.from(chunk));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuthError("VALIDATION_ERROR");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new AuthError("VALIDATION_ERROR");
  return parsed as Row;
}
export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  auth: AuthService | undefined,
  origin: string,
): Promise<boolean> {
  const path = url.pathname;
  if (!(
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/operations/") ||
    [
      "/api/context",
      "/api/users",
      "/api/roles",
      "/api/sites",
      "/api/permissions",
      "/api/audit",
      "/api/ready",
    ].includes(path) ||
    path.startsWith("/api/users/") ||
    path.startsWith("/api/roles/")
  ))
    return false;
  try {
    const method = req.method ?? "GET",
      mutation = method !== "GET";
    if (path === "/api/ready") {
      if (method !== "GET") throw new AuthError("METHOD_NOT_ALLOWED", 405);
      const ready = Boolean(auth && (await auth.ready()));
      json(res, ready ? 200 : 503, {
        status: ready ? "ready" : "unavailable",
        authentication: ready,
        persistence: ready,
      });
      return true;
    }
    if (mutation && req.headers.origin !== origin)
      throw new AuthError("FORBIDDEN", 403);
    if (!auth)
      throw new AuthError(
        path === "/api/context" ? "AUTH_REQUIRED" : "AUTH_UNAVAILABLE",
        path === "/api/context" ? 401 : 503,
      );
    if (!["GET", "POST", "PATCH"].includes(method))
      throw new AuthError("METHOD_NOT_ALLOWED", 405);
    if (method === "POST" && path === "/api/auth/login") {
      const result = await auth.login(
        await body(req),
        req.socket.remoteAddress ?? "unknown",
      );
      res.setHeader(
        "Set-Cookie",
        `restaurant_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      json(res, 200, result.context);
      return true;
    }
    const cookies =
      req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .filter((v) => v.startsWith("restaurant_session=")) ?? [];
    const token =
      cookies.length === 1
        ? cookies[0]!.slice("restaurant_session=".length)
        : undefined;
    if (method === "POST" && path === "/api/auth/logout") {
      const csrf =
        typeof req.headers["x-csrf-token"] === "string"
          ? req.headers["x-csrf-token"]
          : undefined;
      let active = true;
      try {
        await auth.identify(token);
      } catch (error) {
        if (error instanceof AuthError && error.code === "AUTH_REQUIRED")
          active = false;
        else throw error;
      }
      if (!active) {
        const input = await body(req);
        if (Object.keys(input).length) throw new AuthError("VALIDATION_ERROR");
        if (token && !(await auth.logoutProof(token, csrf)))
          throw new AuthError("FORBIDDEN", 403);
        res.setHeader(
          "Set-Cookie",
          `restaurant_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
        );
        json(res, 200, { ok: true });
        return true;
      }
    }
    const identity = await auth.identify(token);
    if (mutation)
      auth.csrf(
        identity,
        typeof req.headers["x-csrf-token"] === "string"
          ? req.headers["x-csrf-token"]
          : undefined,
      );
    const input = mutation ? await body(req) : {};
    const result = await auth.authorized(identity, undefined, (t) =>
      auth.route(method, path, input, identity, t, url),
    );
    if (path === "/api/auth/logout" || path === "/api/auth/password")
      res.setHeader(
        "Set-Cookie",
        `restaurant_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
    json(res, 200, result);
  } catch (error) {
    let code = "INTERNAL_ERROR",
      status = 500;
    if (error instanceof AuthError) {
      code = error.code;
      status = error.status;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "SequelizeUniqueConstraintError"
    ) {
      code = "CONFLICT";
      status = 409;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      String(error.name).includes("Connection")
    ) {
      code = "AUTH_UNAVAILABLE";
      status = 503;
    }
    json(res, status, {
      error: {
        code,
        message:
          code === "INVALID_CREDENTIALS"
            ? "Credenciales no válidas."
            : code === "AUTH_REQUIRED"
              ? "Inicia sesión para continuar."
              : code === "LAST_ADMIN"
                ? "Debe permanecer al menos un administrador activo."
                : "No se pudo completar la solicitud.",
      },
    });
  }
  return true;
}
