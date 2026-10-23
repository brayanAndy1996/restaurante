"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Mode = "cloud" | "local";
type CapabilityKey = "authentication" | "persistence" | "businessOperations" | "continuity";
type Health = {
  service: "restaurante";
  status: "ok";
  mode: Mode;
  capabilities: Record<CapabilityKey, boolean>;
};
type Site = { id: string; code: string; name: string; active: boolean };
type User = { id: string; username: string; active: boolean; roleIds: string[]; siteIds: string[] };
type Role = { id: string; name: string; permissions: string[] };
type AuditEntry = { id: string; action: string; entityId: string | null; actorId: string | null; createdAt: string; outcome: string };
type AuthContext = {
  user: { id: string; username: string; active: boolean };
  tenant: { id: string; code: string; name: string };
  sites: Site[];
  permissions: string[];
  csrfToken: string;
};
type ListResponse<T> = { items: T[] };
type AuditResponse = { items: AuditEntry[]; limit: number; offset: number };
type RequestOptions = { method?: string; body?: unknown; csrfToken?: string };

const PERMISSIONS = {
  users: "usuarios.gestionar",
  roles: "roles.gestionar",
  sites: "locales.asignar",
  audit: "auditoria.consultar",
} as const;
const AUDIT_PAGE_SIZE = 50;

const capabilityLabels: { key: CapabilityKey; label: string }[] = [
  { key: "authentication", label: "Acceso y autenticación" },
  { key: "persistence", label: "Base de datos y persistencia" },
  { key: "businessOperations", label: "Operación comercial" },
  { key: "continuity", label: "Continuidad local" },
];

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  const init: RequestInit = {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers,
  };
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  if (options.csrfToken) headers.set("X-CSRF-Token", options.csrfToken);

  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    const code = typeof envelope?.code === "string" ? envelope.code : `HTTP_${response.status}`;
    const message = typeof envelope?.message === "string" ? envelope.message : "No se pudo completar la solicitud.";
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}

function isHealth(value: unknown): value is Health {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<Health>;
  const capabilities = health.capabilities;
  return health.service === "restaurante" && health.status === "ok" &&
    (health.mode === "cloud" || health.mode === "local") && !!capabilities &&
    typeof capabilities.authentication === "boolean" &&
    typeof capabilities.persistence === "boolean" &&
    typeof capabilities.businessOperations === "boolean" &&
    typeof capabilities.continuity === "boolean";
}

function isAuthContext(value: unknown): value is AuthContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<AuthContext>;
  return !!context.user && typeof context.user.id === "string" && typeof context.user.username === "string" &&
    typeof context.user.active === "boolean" && !!context.tenant && typeof context.tenant.id === "string" &&
    typeof context.tenant.code === "string" && typeof context.tenant.name === "string" &&
    Array.isArray(context.sites) && Array.isArray(context.permissions) &&
    context.permissions.every((permission) => typeof permission === "string") &&
    typeof context.csrfToken === "string";
}

function errorText(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === "FORBIDDEN") return "Tu cuenta no tiene permiso para completar esta acción.";
  if (error.code === "NOT_FOUND") return "El registro ya no está disponible.";
  if (error.code === "CONFLICT") return error.message || "No se pudo guardar el cambio por un conflicto.";
  if (error.code === "RATE_LIMITED") return "Se realizaron demasiados intentos. Espera un momento e inténtalo de nuevo.";
  return error.message || fallback;
}

function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

type CheckboxOption = { id: string; label: string; disabled?: boolean };

function CheckboxGroup({
  id,
  legend,
  options,
  selectedIds,
  onChange,
  emptyMessage,
}: {
  id: string;
  legend: string;
  options: CheckboxOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyMessage: string;
}) {
  const selected = new Set(selectedIds);
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      {options.length === 0 ? <p className="muted compact">{emptyMessage}</p> : (
        <div className="choice-list">
          {options.map((option, index) => {
            const inputId = `${id}-${index}`;
            return (
              <label className="check-row" htmlFor={inputId} key={option.id}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={selected.has(option.id)}
                  disabled={option.disabled}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.currentTarget.checked) next.add(option.id);
                    else next.delete(option.id);
                    onChange([...next]);
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function UserEditor({
  user,
  currentUserId,
  roles,
  sites,
  canAssignRoles,
  canAssignSites,
  busy,
  onSave,
  onResetPassword,
}: {
  user: User;
  currentUserId: string;
  roles: Role[];
  sites: Site[];
  canAssignRoles: boolean;
  canAssignSites: boolean;
  busy: boolean;
  onSave: (id: string, update: { active: boolean; roleIds?: string[]; siteIds?: string[] }) => Promise<boolean>;
  onResetPassword: (user: User, password: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(user.active);
  const [roleIds, setRoleIds] = useState(user.roleIds);
  const [siteIds, setSiteIds] = useState(user.siteIds);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    setActive(user.active);
    setRoleIds(user.roleIds);
    setSiteIds(user.siteIds);
  }, [user.active, user.roleIds, user.siteIds]);

  const roleOptions = roles.map((role) => ({ id: role.id, label: role.name }));
  const visibleSiteIds = new Set(sites.map((site) => site.id));
  const retainedSiteIds = user.siteIds.filter((id) => !visibleSiteIds.has(id));
  const siteOptions = sites.map((site) => ({
    id: site.id,
    label: `${site.name} (${site.code})${site.active ? "" : " · inactivo"}`,
    disabled: !site.active && !siteIds.includes(site.id),
  }));

  const submitUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const update: { active: boolean; roleIds?: string[]; siteIds?: string[] } = { active };
    if (canAssignRoles) update.roleIds = roleIds;
    if (canAssignSites) update.siteIds = [...new Set([...retainedSiteIds, ...siteIds])];
    if (await onSave(user.id, update)) setEditing(false);
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await onResetPassword(user, resetPassword)) {
      setResetPassword("");
      setResetOpen(false);
    }
  };

  return (
    <article className="item-card">
      <div className="section-heading item-heading">
        <div>
          <h3>{user.username}</h3>
          <p className={user.active ? "success compact" : "muted compact"}>{user.active ? "Activo" : "Desactivado"}</p>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy}>
            {editing ? "Cancelar edición" : "Editar"}
          </button>
          {user.id !== currentUserId && (
            <button type="button" onClick={() => setResetOpen((value) => !value)} disabled={busy}>
              {resetOpen ? "Cerrar" : "Restablecer clave"}
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <form className="form-stack" onSubmit={(event) => void submitUpdate(event)}>
          <label className="check-row" htmlFor={`user-active-${user.id}`}>
            <input id={`user-active-${user.id}`} type="checkbox" checked={active} onChange={(event) => setActive(event.currentTarget.checked)} />
            <span>Cuenta activa</span>
          </label>
          {canAssignRoles ? (
            <CheckboxGroup
              id={`user-roles-${user.id}`}
              legend="Roles"
              options={roleOptions}
              selectedIds={roleIds}
              onChange={setRoleIds}
              emptyMessage="Crea un rol antes de asignarlo."
            />
          ) : <p className="muted compact">No tienes permiso para consultar o cambiar los roles de esta cuenta.</p>}
          {canAssignSites && (
            <CheckboxGroup
              id={`user-sites-${user.id}`}
              legend="Locales asignados"
              options={siteOptions}
              selectedIds={siteIds}
              onChange={setSiteIds}
              emptyMessage="No hay locales disponibles para asignar."
            />
          )}
          <div className="button-row">
            <button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
          </div>
        </form>
      ) : (
        <dl className="details compact-details">
          <div><dt>Roles</dt><dd>{canAssignRoles
            ? roles.filter((role) => user.roleIds.includes(role.id)).map((role) => role.name).join(", ") || (user.roleIds.length ? "Asignaciones no disponibles" : "Sin roles")
            : user.roleIds.length ? "Asignados · requiere roles.gestionar para consultar" : "Sin roles"}</dd></div>
          {canAssignSites && <div><dt>Locales</dt><dd>{sites.filter((site) => user.siteIds.includes(site.id)).map((site) => site.name).join(", ") || (user.siteIds.length ? "Asignaciones no disponibles" : "Sin locales asignados")}</dd></div>}
        </dl>
      )}
      {resetOpen && user.id !== currentUserId && (
        <form className="form-stack nested-form" onSubmit={(event) => void submitPassword(event)}>
          <label htmlFor={`reset-password-${user.id}`}>Nueva contraseña</label>
          <input
            id={`reset-password-${user.id}`}
            type="password"
            autoComplete="new-password"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.currentTarget.value)}
            required
          />
          <p className="muted compact">El backend validará entre 12 y 128 caracteres. La persona deberá iniciar sesión con la nueva clave.</p>
          <button type="submit" disabled={busy || !resetPassword}>{busy ? "Restableciendo…" : "Confirmar restablecimiento"}</button>
        </form>
      )}
    </article>
  );
}

function RoleEditor({
  role,
  permissionOptions,
  editable,
  busy,
  onSave,
}: {
  role: Role;
  permissionOptions: string[];
  editable: boolean;
  busy: boolean;
  onSave: (id: string, update: { name: string; permissions?: string[] }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);
  const permissionKey = permissionOptions.join("\u0000");
  const [permissionIds, setPermissionIds] = useState(() => role.permissions.filter((permission) => permissionOptions.includes(permission)));

  useEffect(() => {
    setName(role.name);
    setPermissionIds(role.permissions.filter((permission) => permissionOptions.includes(permission)));
  }, [role.name, role.permissions, permissionKey]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const editablePermissions = role.permissions.filter((permission) => permissionOptions.includes(permission));
    const permissionsChanged = editablePermissions.length !== permissionIds.length || editablePermissions.some((permission) => !permissionIds.includes(permission));
    const update: { name: string; permissions?: string[] } = { name: name.trim() };
    if (permissionsChanged) update.permissions = [...new Set(permissionIds)];
    if (await onSave(role.id, update)) setEditing(false);
  };

  return (
    <article className="item-card">
      <div className="section-heading item-heading">
        <div>
          <h3>{role.name}</h3>
          <p className="muted compact">{role.permissions.length} permisos</p>
        </div>
        {editable ? (
          <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy}>
            {editing ? "Cancelar edición" : "Editar rol"}
          </button>
        ) : <span className="muted compact">No puedes modificar permisos que tu cuenta no posee.</span>}
      </div>
      {editing ? (
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label htmlFor={`role-name-${role.id}`}>Nombre del rol</label>
          <input id={`role-name-${role.id}`} value={name} onChange={(event) => setName(event.currentTarget.value)} required maxLength={80} />
          <CheckboxGroup
            id={`role-permissions-${role.id}`}
            legend="Permisos"
            options={permissionOptions.map((permission) => ({ id: permission, label: permission }))}
            selectedIds={permissionIds}
            onChange={setPermissionIds}
            emptyMessage="El catálogo de permisos no está disponible."
          />
          <button type="submit" disabled={busy || !name.trim()}>{busy ? "Guardando…" : "Guardar rol"}</button>
        </form>
      ) : (
        <p className="muted compact">{role.permissions.join(", ") || "Sin permisos asignados"}</p>
      )}
    </article>
  );
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthState, setHealthState] = useState<"loading" | "ready" | "error">("loading");
  const [healthError, setHealthError] = useState("");
  const [authState, setAuthState] = useState<"checking" | "anonymous" | "authenticated" | "error" | "unavailable">("checking");
  const [session, setSession] = useState<AuthContext | null>(null);
  const [loginNotice, setLoginNotice] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [tenantCode, setTenantCode] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createUsername, setCreateUsername] = useState("");
  const [createUserPassword, setCreateUserPassword] = useState("");
  const [createUserRoleIds, setCreateUserRoleIds] = useState<string[]>([]);
  const [createUserSiteIds, setCreateUserSiteIds] = useState<string[]>([]);
  const [createRoleName, setCreateRoleName] = useState("");
  const [createRolePermissions, setCreateRolePermissions] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<string[]>([]);
  const [auditItems, setAuditItems] = useState<AuditEntry[]>([]);
  const [auditLimit, setAuditLimit] = useState(AUDIT_PAGE_SIZE);
  const [auditOffset, setAuditOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  const clearSession = useCallback((notice = "") => {
    setSession(null);
    setAuthState("anonymous");
    setLoginNotice(notice);
    setLoginError("");
    setActionError("");
    setActionMessage("");
    setCurrentPassword("");
    setNewPassword("");
    setCreateUserPassword("");
    setUsers([]);
    setRoles([]);
    setSites([]);
    setPermissionCatalog([]);
    setAuditItems([]);
    setAuditOffset(0);
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthState("loading");
    setHealthError("");
    try {
      const payload: unknown = await apiRequest("/api/health");
      if (!isHealth(payload)) {
        setHealthError("La API respondió con un diagnóstico inválido.");
        setHealthState("error");
        return;
      }
      setHealth(payload);
      setHealthState("ready");
    } catch {
      setHealthError("No se pudo consultar la API. Comprueba el servidor e inténtalo de nuevo.");
      setHealthState("error");
    }
  }, []);

  const checkContext = useCallback(async () => {
    setAuthState("checking");
    setLoginError("");
    try {
      const payload: unknown = await apiRequest("/api/context");
      if (!isAuthContext(payload)) throw new Error("El contexto de sesión no tiene el formato esperado.");
      setSession(payload);
      setAuthState("authenticated");
      setLoginNotice("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        setAuthState("anonymous");
        return;
      }
      if (error instanceof ApiError && error.status === 503) {
        setSession(null);
        setAuthState("unavailable");
        setLoginError(error.code === "AUTH_UNAVAILABLE"
          ? "El acceso comercial no está habilitado en modo local."
          : "El servicio de acceso no está disponible en este momento.");
        return;
      }
      setSession(null);
      setAuthState("error");
      setLoginError(errorText(error, "No se pudo confirmar la sesión."));
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    void checkContext();
  }, [checkHealth, checkContext]);

  useEffect(() => {
    if (authState !== "authenticated" || !session) return;
    let active = true;
    let expired = false;
    const canManageUsers = session.permissions.includes(PERMISSIONS.users);
    const canManageRoles = session.permissions.includes(PERMISSIONS.roles);
    const canAssignSites = session.permissions.includes(PERMISSIONS.sites);
    const canReadAudit = session.permissions.includes(PERMISSIONS.audit);
    setSectionErrors({});
    setUsersLoading(canManageUsers);
    setRolesLoading(canManageRoles);
    setSitesLoading(canAssignSites);
    setAuditLoading(canReadAudit);

    const load = async <T,>(key: string, path: string, apply: (data: T) => void) => {
      try {
        const data = await apiRequest<T>(path);
        if (active && !expired) apply(data);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          expired = true;
          if (active) clearSession("La sesión venció. Vuelve a iniciar sesión.");
        } else if (active && !expired) {
          setSectionErrors((previous) => ({ ...previous, [key]: errorText(error, "No se pudo cargar esta sección.") }));
        }
      }
    };
    const finish = (setter: (loading: boolean) => void) => {
      setter(false);
    };
    const jobs: Promise<void>[] = [];
    if (canManageUsers) jobs.push(load<ListResponse<User>>("users", "/api/users", (data) => setUsers(data.items)).finally(() => { if (active && !expired) finish(setUsersLoading); }));
    if (canManageRoles) {
      jobs.push(load<ListResponse<Role>>("roles", "/api/roles", (data) => setRoles(data.items)).finally(() => { if (active && !expired) finish(setRolesLoading); }));
      jobs.push(load<ListResponse<string>>("permissions", "/api/permissions", (data) => setPermissionCatalog(data.items)));
    }
    if (canAssignSites) jobs.push(load<ListResponse<Site>>("sites", "/api/sites", (data) => setSites(data.items)).finally(() => { if (active && !expired) finish(setSitesLoading); }));
    if (canReadAudit) {
      const query = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE), offset: String(auditOffset) });
      jobs.push(load<AuditResponse>("audit", `/api/audit?${query.toString()}`, (data) => {
        setAuditItems(data.items);
        setAuditLimit(data.limit);
        setAuditOffset(data.offset);
      }).finally(() => { if (active && !expired) finish(setAuditLoading); }));
    }
    void Promise.all(jobs);
    return () => { active = false; };
  }, [authState, session, refreshVersion, auditOffset, clearSession]);

  const onLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginPending(true);
    setLoginError("");
    setLoginNotice("");
    try {
      const payload: unknown = await apiRequest("/api/auth/login", {
        method: "POST",
        body: { tenantCode: tenantCode.trim(), username: loginUsername.trim(), password: loginPassword },
      });
      if (!isAuthContext(payload)) throw new Error("La respuesta de acceso no tiene el formato esperado.");
      setSession(payload);
      setAuthState("authenticated");
      setTenantCode("");
      setLoginUsername("");
      setLoginPassword("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 503 && error.code === "AUTH_UNAVAILABLE") {
        setLoginError("El acceso comercial no está habilitado en modo local.");
      } else {
        setLoginError(errorText(error, "No se pudo iniciar sesión."));
      }
    } finally {
      setLoginPending(false);
    }
  };

  const performMutation = useCallback(async (
    key: string,
    path: string,
    method: string,
    body: unknown,
    successMessage: string,
  ): Promise<boolean> => {
    if (!session) return false;
    setPendingAction(key);
    setActionError("");
    setActionMessage("");
    try {
      await apiRequest(path, { method, body, csrfToken: session.csrfToken });
      setActionMessage(successMessage);
      setRefreshVersion((version) => version + 1);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession("La sesión venció. Vuelve a iniciar sesión.");
      } else {
        setActionError(errorText(error, "No se pudo completar la acción."));
      }
      return false;
    } finally {
      setPendingAction(null);
    }
  }, [session, clearSession]);

  const onLogout = async () => {
    if (!session) return;
    setPendingAction("logout");
    setActionError("");
    try {
      await apiRequest("/api/auth/logout", { method: "POST", body: {}, csrfToken: session.csrfToken });
      clearSession("Sesión cerrada.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearSession("La sesión ya no está activa. Vuelve a iniciar sesión.");
      else setActionError(errorText(error, "No se pudo cerrar la sesión."));
    } finally {
      setPendingAction(null);
    }
  };

  const onChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const changed = await performMutation("own-password", "/api/auth/password", "POST", {
      currentPassword,
      newPassword,
    }, "Contraseña cambiada.");
    if (changed) clearSession("La contraseña cambió. Inicia sesión con la nueva clave.");
  };

  const onCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    const body: Record<string, unknown> = {
      username: createUsername.trim(),
      password: createUserPassword,
    };
    if (session.permissions.includes(PERMISSIONS.roles)) body.roleIds = createUserRoleIds;
    if (session.permissions.includes(PERMISSIONS.sites)) body.siteIds = createUserSiteIds;
    const created = await performMutation("create-user", "/api/users", "POST", body, "Usuario creado.");
    if (created) {
      setCreateUsername("");
      setCreateUserPassword("");
      setCreateUserRoleIds([]);
      setCreateUserSiteIds([]);
    }
  };

  const onSaveUser = async (id: string, update: { active: boolean; roleIds?: string[]; siteIds?: string[] }) =>
    performMutation(`user-${id}`, `/api/users/${encodeURIComponent(id)}`, "PATCH", update, "Usuario actualizado.");

  const onResetUserPassword = async (user: User, password: string) => {
    const changed = await performMutation(`reset-${user.id}`, `/api/users/${encodeURIComponent(user.id)}/password`, "POST", { password }, "Contraseña restablecida.");
    if (changed && session?.user.id === user.id) clearSession("Tu contraseña se restableció. Inicia sesión con la nueva clave.");
    return changed;
  };

  const onCreateRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const created = await performMutation("create-role", "/api/roles", "POST", {
      name: createRoleName.trim(),
      permissions: createRolePermissions,
    }, "Rol creado.");
    if (created) {
      setCreateRoleName("");
      setCreateRolePermissions([]);
    }
  };

  const onSaveRole = (id: string, update: { name: string; permissions?: string[] }) =>
    performMutation(`role-${id}`, `/api/roles/${encodeURIComponent(id)}`, "PATCH", update, "Rol actualizado.");

  const onLogoutNotice = authState === "authenticated" && session;
  const localMode = health?.mode === "local";

  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">Restaurante · acceso</p>
        <h1>Acceso y administración</h1>
        <p className="intro">Ingresa con la empresa, tu usuario y contraseña. El acceso y las acciones disponibles se validan en el servidor.</p>
      </header>

      <section className="panel" aria-labelledby="access-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Sesión protegida</p>
            <h2 id="access-title">{authState === "authenticated" && session ? session.tenant.name : "Ingresar"}</h2>
          </div>
          {onLogoutNotice && <button type="button" onClick={() => void onLogout()} disabled={pendingAction === "logout"}>{pendingAction === "logout" ? "Cerrando…" : "Cerrar sesión"}</button>}
        </div>

        {authState === "checking" && <p className="status-line" role="status">Comprobando sesión…</p>}
        {authState === "error" && (
          <div>
            <p className="status-line error" role="alert">{loginError}</p>
            <button type="button" onClick={() => void checkContext()}>Reintentar consulta de sesión</button>
          </div>
        )}
        {authState === "unavailable" && (
          <div>
            <p className="status-line pending" role="status">{loginError}</p>
            <button type="button" onClick={() => void checkContext()}>Reintentar</button>
          </div>
        )}
        {authState === "anonymous" && healthState === "loading" && (
          <p className="status-line" role="status">Comprobando el modo del servicio…</p>
        )}
        {authState === "anonymous" && localMode && (
          <p className="status-line pending" role="status">El modo local no habilita el acceso comercial. El servicio responde en modo de diagnóstico.</p>
        )}
        {authState === "anonymous" && healthState !== "loading" && !localMode && (
          <>
            {loginNotice && <p className="status-line pending" role="status">{loginNotice}</p>}
            {loginError && <p className="status-line error" role="alert">{loginError}</p>}
            <form className="form-grid login-form" onSubmit={(event) => void onLogin(event)}>
              <div className="field">
                <label htmlFor="tenant-code">Empresa</label>
                <input id="tenant-code" autoComplete="organization" autoCapitalize="none" value={tenantCode} onChange={(event) => setTenantCode(event.currentTarget.value)} required minLength={3} maxLength={48} />
              </div>
              <div className="field">
                <label htmlFor="login-username">Usuario</label>
                <input id="login-username" autoComplete="username" autoCapitalize="none" value={loginUsername} onChange={(event) => setLoginUsername(event.currentTarget.value)} required minLength={3} maxLength={48} />
              </div>
              <div className="field">
                <label htmlFor="login-password">Contraseña</label>
                <input id="login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.currentTarget.value)} required />
              </div>
              <div className="form-actions">
                <button type="submit" disabled={loginPending}>{loginPending ? "Ingresando…" : "Ingresar"}</button>
              </div>
            </form>
          </>
        )}

        {authState === "authenticated" && session && (
          <div className="session-summary">
            <dl className="details">
              <div><dt>Empresa</dt><dd>{session.tenant.name} ({session.tenant.code})</dd></div>
              <div><dt>Usuario</dt><dd>{session.user.username}</dd></div>
              <div><dt>Locales disponibles</dt><dd>{session.sites.length ? session.sites.map((site) => `${site.name}${site.active ? "" : " (inactivo)"}`).join(", ") : "Sin locales asignados"}</dd></div>
            </dl>
            <p className="muted compact">Los paneles de administración aparecen según tus permisos actuales.</p>
          </div>
        )}
      </section>

      {authState === "authenticated" && session && (
        <>
          {actionError && <p className="panel status-line error" role="alert">{actionError}</p>}
          {actionMessage && <p className="panel status-line success" role="status">{actionMessage}</p>}

          <section className="panel" aria-labelledby="password-title">
            <p className="eyebrow">Cuenta propia</p>
            <h2 id="password-title">Cambiar contraseña</h2>
            <form className="form-grid" onSubmit={(event) => void onChangePassword(event)}>
              <div className="field">
                <label htmlFor="current-password">Contraseña actual</label>
                <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} required />
              </div>
              <div className="field">
                <label htmlFor="new-password">Nueva contraseña</label>
                <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} required />
                <span className="field-hint">Entre 12 y 128 caracteres. El servidor valida el límite exacto.</span>
              </div>
              <div className="form-actions"><button type="submit" disabled={pendingAction === "own-password" || !currentPassword || !newPassword}>{pendingAction === "own-password" ? "Actualizando…" : "Cambiar y volver a ingresar"}</button></div>
            </form>
          </section>

          {session.permissions.includes(PERMISSIONS.users) && (
            <section className="panel" aria-labelledby="users-title">
              <p className="eyebrow">Administración de acceso</p>
              <h2 id="users-title">Usuarios</h2>
              {sectionErrors.users && <p className="status-line error" role="alert">{sectionErrors.users}</p>}
              {usersLoading && <p className="muted" role="status">Cargando usuarios…</p>}
              {!usersLoading && !sectionErrors.users && users.length === 0 && <p className="muted">Todavía no hay usuarios para mostrar.</p>}
              <div className="record-list">
                {users.map((user) => (
                  <UserEditor
                    key={user.id}
                    user={user}
                    currentUserId={session.user.id}
                    roles={roles}
                    sites={sites}
                    canAssignRoles={session.permissions.includes(PERMISSIONS.roles)}
                    canAssignSites={session.permissions.includes(PERMISSIONS.sites)}
                    busy={pendingAction === `user-${user.id}` || pendingAction === `reset-${user.id}`}
                    onSave={onSaveUser}
                    onResetPassword={onResetUserPassword}
                  />
                ))}
              </div>
              <div className="subsection">
                <h3>Crear usuario</h3>
                {sectionErrors.roles && <p className="status-line error" role="alert">Para asignar roles, revisa la carga de roles.</p>}
                <form className="form-stack" onSubmit={(event) => void onCreateUser(event)}>
                  <div className="field">
                    <label htmlFor="new-username">Nombre de usuario</label>
                    <input id="new-username" autoComplete="off" autoCapitalize="none" value={createUsername} onChange={(event) => setCreateUsername(event.currentTarget.value)} required minLength={3} maxLength={48} />
                  </div>
                  <div className="field">
                    <label htmlFor="new-user-password">Contraseña inicial</label>
                    <input id="new-user-password" type="password" autoComplete="new-password" value={createUserPassword} onChange={(event) => setCreateUserPassword(event.currentTarget.value)} required />
                    <span className="field-hint">Entre 12 y 128 caracteres. No se muestra de nuevo después de crear la cuenta.</span>
                  </div>
                  {session.permissions.includes(PERMISSIONS.roles) ? (
                    <CheckboxGroup
                      id="new-user-roles"
                      legend="Roles asignados"
                      options={roles.map((role) => ({ id: role.id, label: role.name }))}
                      selectedIds={createUserRoleIds}
                      onChange={setCreateUserRoleIds}
                      emptyMessage="No hay roles cargados. Puedes crear el usuario sin roles y asignarlos después."
                    />
                  ) : <p className="muted compact">El usuario se creará sin roles. Se requiere roles.gestionar para consultar y asignar roles.</p>}
                  {session.permissions.includes(PERMISSIONS.sites) && (
                    <CheckboxGroup
                      id="new-user-sites"
                      legend="Locales asignados"
                      options={sites.filter((site) => site.active).map((site) => ({ id: site.id, label: `${site.name} (${site.code})` }))}
                      selectedIds={createUserSiteIds}
                      onChange={setCreateUserSiteIds}
                      emptyMessage={sitesLoading ? "Cargando locales…" : "No hay locales activos disponibles."}
                    />
                  )}
                  <button type="submit" disabled={pendingAction === "create-user" || !createUsername.trim() || !createUserPassword}>{pendingAction === "create-user" ? "Creando…" : "Crear usuario"}</button>
                </form>
              </div>
            </section>
          )}

          {session.permissions.includes(PERMISSIONS.roles) && (
            <section className="panel" aria-labelledby="roles-title">
              <p className="eyebrow">Autorización</p>
              <h2 id="roles-title">Roles y permisos</h2>
              {sectionErrors.roles && <p className="status-line error" role="alert">{sectionErrors.roles}</p>}
              {sectionErrors.permissions && <p className="status-line error" role="alert">{sectionErrors.permissions}</p>}
              {rolesLoading && <p className="muted" role="status">Cargando roles…</p>}
              {!rolesLoading && !sectionErrors.roles && roles.length === 0 && <p className="muted">Todavía no hay roles para mostrar.</p>}
              <div className="record-list">
                {roles.map((role) => (
                  <RoleEditor
                    key={role.id}
                    role={role}
                    permissionOptions={permissionCatalog.filter((permission) => session.permissions.includes(permission))}
                    editable={role.permissions.every((permission) => session.permissions.includes(permission) && permissionCatalog.includes(permission))}
                    busy={pendingAction === `role-${role.id}`}
                    onSave={onSaveRole}
                  />
                ))}
              </div>
              <div className="subsection">
                <h3>Crear rol</h3>
                <form className="form-stack" onSubmit={(event) => void onCreateRole(event)}>
                  <div className="field">
                    <label htmlFor="new-role-name">Nombre del rol</label>
                    <input id="new-role-name" value={createRoleName} onChange={(event) => setCreateRoleName(event.currentTarget.value)} required maxLength={80} />
                  </div>
                  <CheckboxGroup
                    id="new-role-permissions"
                    legend="Permisos"
                    options={permissionCatalog.filter((permission) => session.permissions.includes(permission)).map((permission) => ({ id: permission, label: permission }))}
                    selectedIds={createRolePermissions}
                    onChange={setCreateRolePermissions}
                    emptyMessage={sectionErrors.permissions ? "No se pudo cargar el catálogo." : "Cargando catálogo de permisos…"}
                  />
                  <button type="submit" disabled={pendingAction === "create-role" || !createRoleName.trim()}>{pendingAction === "create-role" ? "Creando…" : "Crear rol"}</button>
                </form>
              </div>
            </section>
          )}

          {session.permissions.includes(PERMISSIONS.audit) && (
            <section className="panel" aria-labelledby="audit-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Trazabilidad</p>
                  <h2 id="audit-title">Auditoría</h2>
                </div>
                <button type="button" onClick={() => setRefreshVersion((version) => version + 1)} disabled={auditLoading}>Actualizar</button>
              </div>
              {sectionErrors.audit && <p className="status-line error" role="alert">{sectionErrors.audit}</p>}
              {auditLoading && <p className="muted" role="status">Cargando eventos…</p>}
              {!auditLoading && !sectionErrors.audit && auditItems.length === 0 && <p className="muted">No hay eventos en esta página.</p>}
              {auditItems.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th scope="col">Fecha</th><th scope="col">Acción</th><th scope="col">Entidad</th><th scope="col">Actor</th><th scope="col">Resultado</th></tr></thead>
                    <tbody>
                      {auditItems.map((entry) => (
                        <tr key={entry.id}>
                          <td><time dateTime={entry.createdAt}>{formatAuditDate(entry.createdAt)}</time></td>
                          <td>{entry.action}</td>
                          <td>{entry.entityId ?? "—"}</td>
                          <td>{entry.actorId ?? "—"}</td>
                          <td>{entry.outcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="pagination" aria-label="Paginación de auditoría">
                <span className="muted">Eventos {auditItems.length ? auditOffset + 1 : 0}–{auditOffset + auditItems.length} · página de {auditLimit}</span>
                <div className="button-row">
                  <button type="button" onClick={() => setAuditOffset((offset) => Math.max(0, offset - AUDIT_PAGE_SIZE))} disabled={auditOffset === 0 || auditLoading}>Anterior</button>
                  <button type="button" onClick={() => setAuditOffset((offset) => offset + AUDIT_PAGE_SIZE)} disabled={auditItems.length < auditLimit || auditLoading}>Siguiente</button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <section className="panel" aria-labelledby="diagnostic-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Diagnóstico técnico</p>
            <h2 id="diagnostic-title">Disponibilidad del servicio</h2>
          </div>
          <button type="button" onClick={() => void checkHealth()} disabled={healthState === "loading"}>
            {healthState === "loading" ? "Consultando…" : "Reintentar diagnóstico"}
          </button>
        </div>
        {healthState === "loading" && <p className="status-line" role="status">Consultando la API…</p>}
        {healthState === "error" && <p className="status-line error" role="alert">{healthError}</p>}
        {healthState === "ready" && health && (
          <div role="status" aria-live="polite">
            <p className="status-line success">API disponible · modo {health.mode === "cloud" ? "nube" : "local"}</p>
            <p className="muted compact">El proceso HTTP responde; este diagnóstico no confirma la conexión a una base de datos.</p>
            <ul className="capability-list">
              {capabilityLabels.map(({ key, label }) => (
                <li key={key}>
                  <span>{label}</span>
                  <strong className={health.capabilities[key] ? "capability-ready" : "capability-pending"}>
                    {health.capabilities[key] ? "Disponible" : "Pendiente"}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <footer className="page-footer">
        Esta entrega administra acceso, roles y auditoría. Las ventas, caja, mesas, comandas y continuidad comercial siguen pendientes.
      </footer>
    </main>
  );
}
