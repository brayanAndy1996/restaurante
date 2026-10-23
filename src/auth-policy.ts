import { createHash, randomBytes } from "node:crypto";
export const ADMIN_PERMISSIONS = [
  "usuarios.gestionar",
  "roles.gestionar",
  "locales.asignar",
  "auditoria.consultar",
] as const;
export const PERMISSIONS = [
  ...ADMIN_PERMISSIONS,
  "carta.consultar",
  "carta.gestionar",
  "stock.ajustar",
  "salon.gestionar",
  "mesas.operar",
] as const;
export class AuthError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function normalizeIdentifier(value: unknown): string {
  if (typeof value !== "string") throw new AuthError("VALIDATION_ERROR");
  const s = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,48}$/.test(s)) throw new AuthError("VALIDATION_ERROR");
  return s;
}
export function validatePassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].length < 12 ||
    [...value].length > 128 ||
    Buffer.byteLength(value, "utf8") > 512
  )
    throw new AuthError("VALIDATION_ERROR");
  return value;
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
export function fields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    throw new AuthError("VALIDATION_ERROR");
}
export function text(value: unknown, max = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AuthError("VALIDATION_ERROR");
  return value.trim();
}
export function ids(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (v) =>
        typeof v !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          v,
        ),
    )
  )
    throw new AuthError("VALIDATION_ERROR");
  return [...new Set(value)] as string[];
}
