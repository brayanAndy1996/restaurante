import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import {
  createServer as createNodeServer,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "./config.js";
import type { AuthService } from "./auth.js";
import { handleAuth } from "./auth-http.js";

interface ErrorBody {
  error: { code: string; message: string };
}

const apiCapabilities = {
  authentication: false,
  persistence: false,
  businessOperations: false,
  continuity: false,
} as const;

const errorBodies = {
  AUTH_REQUIRED: {
    error: {
      code: "AUTH_REQUIRED",
      message: "Autenticación pendiente de implementación.",
    },
  },
  NOT_FOUND: { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } },
  METHOD_NOT_ALLOWED: {
    error: { code: "METHOD_NOT_ALLOWED", message: "Método no permitido." },
  },
  BAD_REQUEST: {
    error: { code: "BAD_REQUEST", message: "Solicitud no válida." },
  },
  INTERNAL_ERROR: {
    error: {
      code: "INTERNAL_ERROR",
      message: "No se pudo atender la solicitud.",
    },
  },
} satisfies Record<string, ErrorBody>;

const deniedSegments = new Set([
  ".next",
  ".git",
  "app",
  "src",
  "tests",
  "scripts",
  "node_modules",
  "coverage",
]);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(
  response: ServerResponse,
  status: number,
  body: ErrorBody | object,
  extraHeaders: Record<string, string> = {},
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function isDeniedName(segment: string): boolean {
  const lowerSegment = segment.toLowerCase();
  return (
    segment.startsWith(".") ||
    deniedSegments.has(lowerSegment) ||
    /\.(?:ts|tsx|mts|cts|map)$/i.test(segment) ||
    /^(?:package(?:-lock)?\.json|tsconfig(?:\.[^/]*)?\.json|next\.config\.[^/]+|eslint\.config\.[^/]+)$/i.test(
      segment,
    )
  );
}

function safeSegments(pathname: string): string[] | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (
    !decoded.startsWith("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0")
  )
    return undefined;
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        isDeniedName(segment),
    )
  )
    return undefined;
  return segments;
}

function hasDeniedCanonicalSegment(
  root: string,
  canonicalPath: string,
): boolean {
  const pathFromRoot = relative(root, canonicalPath);
  if (!isInside(root, canonicalPath)) return true;
  return pathFromRoot
    .split(/[\\/]/)
    .some((segment) => segment.length > 0 && isDeniedName(segment));
}

async function resolveExportFile(
  exportRoot: string,
  pathname: string,
): Promise<
  { path: string; info: Awaited<ReturnType<typeof stat>> } | undefined
> {
  const segments = safeSegments(pathname);
  if (!segments) return undefined;

  const isDirectoryRequest = pathname.endsWith("/") || segments.length === 0;
  const relativePath = segments.join(sep);
  const candidates = isDirectoryRequest
    ? [resolve(exportRoot, relativePath, "index.html")]
    : [
        resolve(exportRoot, relativePath),
        ...(extname(relativePath)
          ? []
          : [
              resolve(exportRoot, `${relativePath}.html`),
              resolve(exportRoot, relativePath, "index.html"),
            ]),
      ];

  for (const candidate of candidates) {
    if (!isInside(exportRoot, candidate)) continue;
    try {
      const canonicalPath = await realpath(candidate);
      if (hasDeniedCanonicalSegment(exportRoot, canonicalPath)) continue;
      const info = await stat(canonicalPath);
      if (info.isFile()) return { path: canonicalPath, info };
    } catch {
      // A missing export path is handled as a normal 404 and never reveals its filesystem location.
    }
  }
  return undefined;
}

function sendStatic(
  response: ServerResponse,
  file: { path: string; info: Awaited<ReturnType<typeof stat>> },
): void {
  const extension = extname(file.path).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    "Content-Length": String(file.info.size),
    "Cache-Control":
      extension === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  const stream = createReadStream(file.path);
  stream.on("error", () => {
    if (response.headersSent) response.destroy();
    else sendJson(response, 500, errorBodies.INTERNAL_ERROR);
  });
  stream.pipe(response);
}

export async function createHttpServer(
  config: AppConfig,
  options: { staticRoot?: string; auth?: AuthService; origin?: string } = {},
): Promise<Server> {
  const staticRoot = resolve(
    options.staticRoot ?? resolve(process.cwd(), "out"),
  );
  let exportRoot: string;
  try {
    const rootInfo = await lstat(staticRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("invalid-export");
    exportRoot = await realpath(staticRoot);
  } catch {
    throw new Error(
      "No se encontró la exportación estática de Next.js. Ejecuta npm run build:frontend.",
    );
  }

  return createNodeServer(async (request, response) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      sendJson(response, 400, errorBodies.BAD_REQUEST);
      return;
    }

    if (
      (pathname !== "/api/context" ||
        (config.mode === "cloud" && options.auth)) &&
      (await handleAuth(
        request,
        response,
        new URL(request.url ?? "/", "http://127.0.0.1"),
        config.mode === "cloud" ? options.auth : undefined,
        options.origin ?? `http://127.0.0.1:${config.port}`,
      ))
    )
      return;
    if (pathname === "/api/health" || pathname === "/api/context") {
      if (request.method !== "GET") {
        sendJson(response, 405, errorBodies.METHOD_NOT_ALLOWED, {
          Allow: "GET",
        });
        return;
      }
      if (pathname === "/api/health") {
        const ready = Boolean(
          config.mode === "cloud" &&
          options.auth &&
          (await options.auth.ready()),
        );
        sendJson(response, 200, {
          service: "restaurante",
          status: "ok",
          mode: config.mode,
          capabilities: {
            ...apiCapabilities,
            authentication: ready,
            persistence: ready,
          },
        });
        return;
      }
      sendJson(response, 401, errorBodies.AUTH_REQUIRED);
      return;
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      sendJson(response, 404, errorBodies.NOT_FOUND);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, errorBodies.METHOD_NOT_ALLOWED, { Allow: "GET" });
      return;
    }

    const file = await resolveExportFile(exportRoot, pathname);
    if (!file) {
      sendJson(response, 404, errorBodies.NOT_FOUND);
      return;
    }
    sendStatic(response, file);
  });
}
