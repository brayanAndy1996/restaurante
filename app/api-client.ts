export type Site = { id: string; code: string; name: string; active: boolean };

export type AuthContext = {
  user: { id: string; username: string; active: boolean };
  tenant: { id: string; code: string; name: string };
  sites: Site[];
  permissions: string[];
  csrfToken: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  csrfToken?: string;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  const init: RequestInit = {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    signal: options.signal,
  };
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  if (options.csrfToken) headers.set("X-CSRF-Token", options.csrfToken);

  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    const code =
      typeof envelope?.code === "string"
        ? envelope.code
        : `HTTP_${response.status}`;
    const message =
      typeof envelope?.message === "string"
        ? envelope.message
        : "No se pudo completar la solicitud.";
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}

export function errorText(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === "FORBIDDEN")
    return "Tu cuenta no tiene permiso para completar esta acción.";
  if (error.code === "NOT_FOUND") return "El registro ya no está disponible.";
  if (error.code === "CONFLICT")
    return error.message || "No se pudo guardar el cambio por un conflicto.";
  if (error.code === "RATE_LIMITED")
    return "Se realizaron demasiados intentos. Espera un momento e inténtalo de nuevo.";
  return error.message || fallback;
}
