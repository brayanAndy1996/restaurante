/**
 * Generadores de SQL para las migraciones de tablas con datos de clientes. Cada migración que crea
 * una tabla de empresa debe usar `sqlTablaDeEmpresa` (o `sqlTablaDePlataforma` para una tabla que
 * solo toca la vía de plataforma) en la misma migración que la crea: así la RLS, la política y los
 * privilegios explícitos nunca se olvidan (criterio 38 de la historia 001).
 *
 * Nunca se concede `TRUNCATE`, `REFERENCES` ni `TRIGGER`: `TRUNCATE` ignora la RLS.
 *
 * Historia 002: las tablas nuevas usan `sqlTablaDeEmpresaTrazable` (al final de este archivo), que
 * agrega la trazabilidad de quién creó y quién cambió cada fila (convención para las tablas futuras:
 * si una tabla nueva con `empresa_id` no lleva el trigger `trazabilidad`, la prueba de catálogo del
 * criterio 113 falla; la lista cerrada de excepciones no se amplía sin cambiar la especificación).
 */

export type PrivilegioDml = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const PRIVILEGIOS_VALIDOS: readonly PrivilegioDml[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

function identificador(valor: string): string {
  if (!IDENTIFICADOR.test(valor)) {
    throw new Error(`Identificador SQL no permitido en la migración: "${valor}"`);
  }
  return valor;
}

function privilegios(lista: readonly PrivilegioDml[]): string {
  if (lista.length === 0) throw new Error('Se necesita al menos un privilegio');
  for (const privilegio of lista) {
    if (!PRIVILEGIOS_VALIDOS.includes(privilegio)) {
      throw new Error(`Privilegio no permitido: ${String(privilegio)}`);
    }
  }
  return [...new Set(lista)].join(', ');
}

export interface OpcionesTablaDeEmpresa {
  /** Privilegios de `restaurante_api` (se aplican bajo la política `aislamiento_empresa`). */
  privilegiosApi: readonly PrivilegioDml[];
  /**
   * Privilegios de `restaurante_plataforma`, si la tabla también se toca por esa vía. Con una lista vacía
   * la tabla lleva la política `acceso_plataforma` (toda tabla de clientes la tiene, criterio 88) pero
   * ningún privilegio: la plataforma no la toca.
   */
  privilegiosPlataforma?: readonly PrivilegioDml[];
  /** Columna con la empresa dueña de la fila; `id` en la propia tabla `empresa`. Por defecto `empresa_id`. */
  columnaEmpresa?: string;
}

/**
 * RLS activada y forzada, política `aislamiento_empresa` para `restaurante_api` (con
 * `empresa_actual()` en `USING` y `WITH CHECK`), política `acceso_plataforma` si corresponde y los
 * `GRANT` explícitos. La tabla ya debe existir.
 */
export function sqlTablaDeEmpresa(tabla: string, opciones: OpcionesTablaDeEmpresa): string {
  const t = identificador(tabla);
  const columna = identificador(opciones.columnaEmpresa ?? 'empresa_id');
  const partes = [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY aislamiento_empresa ON ${t} AS PERMISSIVE FOR ALL TO restaurante_api
       USING (${columna} = (SELECT empresa_actual()))
       WITH CHECK (${columna} = (SELECT empresa_actual()));`,
    `GRANT ${privilegios(opciones.privilegiosApi)} ON ${t} TO restaurante_api;`,
  ];
  if (opciones.privilegiosPlataforma && opciones.privilegiosPlataforma.length > 0) {
    partes.push(sqlTablaDePlataforma(t, opciones.privilegiosPlataforma, { activarRls: false }));
  } else if (opciones.privilegiosPlataforma) {
    partes.push(
      `CREATE POLICY acceso_plataforma ON ${t} AS PERMISSIVE FOR ALL TO restaurante_plataforma
         USING (true) WITH CHECK (true);`,
    );
  }
  return partes.join('\n');
}

/**
 * Tabla que solo toca `restaurante_plataforma` (por ejemplo la auditoría): RLS forzada, política
 * `acceso_plataforma` y privilegios explícitos. `restaurante_api` no recibe nada.
 */
export function sqlTablaDePlataforma(
  tabla: string,
  privilegiosPlataforma: readonly PrivilegioDml[],
  opciones: { activarRls?: boolean } = {},
): string {
  const t = identificador(tabla);
  const partes: string[] = [];
  if (opciones.activarRls !== false) {
    partes.push(
      `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    );
  }
  partes.push(
    `CREATE POLICY acceso_plataforma ON ${t} AS PERMISSIVE FOR ALL TO restaurante_plataforma
       USING (true) WITH CHECK (true);`,
    `GRANT ${privilegios(privilegiosPlataforma)} ON ${t} TO restaurante_plataforma;`,
  );
  return partes.join('\n');
}

export interface OpcionesTrazabilidad {
  /** Columna con la empresa dueña de la fila; `id` en la propia tabla `empresa`. Por defecto `empresa_id`. */
  columnaEmpresa?: string;
  /**
   * Para una tabla que ya tiene filas: actor de sistema (por ejemplo `migracion:trazabilidad`) con el que
   * quedan creadas y cambiadas por última vez las filas existentes, antes de agregar los `CHECK`. Se
   * quita y se vuelve a poner `FORCE ROW LEVEL SECURITY` solo mientras dura la actualización, porque el
   * migrador (dueño) queda sujeto a la RLS forzada y sin política no vería ninguna fila.
   */
  rellenarFilasExistentesCon?: string;
}

/** Los dos grupos de columnas de trazabilidad. */
const GRUPOS_DE_TRAZABILIDAD = ['creado_por', 'actualizado_por'] as const;

/** Escapa un texto como literal SQL (las migraciones lo usan solo con valores propios, no del usuario). */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

/**
 * Agrega a una tabla ya creada las columnas `creado_por_*` y `actualizado_por_*` (usuario, equipo,
 * superadministrador y sistema), sus `CHECK` (exactamente uno entre usuario, superadministrador y
 * sistema; equipo solo con usuario), las llaves foráneas compuestas con la empresa hacia `usuario` y
 * simples hacia `superadministrador`, y el trigger `trazabilidad` (criterios 113 a 115).
 *
 * Las llaves hacia `equipo` no se agregan aquí: la tabla `equipo` llega con la migración de la historia
 * HU-02 (C2), que las agrega a todas las tablas trazadas que existan; hasta entonces `*_equipo_id`
 * queda sin llave (siempre nulo). Requiere que existan `usuario`, `superadministrador` y la función
 * `public.trazabilidad()` (migraciones `acceso-base` y `trazabilidad`).
 *
 * `sqlTablaDeEmpresa` no cambia: la usan las migraciones de 001, y si su salida cambiara una base nueva
 * crearía las columnas dos veces.
 */
export function sqlTrazabilidad(tabla: string, opciones: OpcionesTrazabilidad = {}): string {
  const t = identificador(tabla);
  const columnaEmpresa = identificador(opciones.columnaEmpresa ?? 'empresa_id');
  const partes: string[] = [];

  for (const grupo of GRUPOS_DE_TRAZABILIDAD) {
    partes.push(
      `ALTER TABLE ${t}
         ADD COLUMN ${grupo}_usuario_id uuid,
         ADD COLUMN ${grupo}_equipo_id uuid,
         ADD COLUMN ${grupo}_superadministrador_id uuid,
         ADD COLUMN ${grupo}_sistema text;`,
    );
  }

  if (opciones.rellenarFilasExistentesCon !== undefined) {
    const sistema = literal(opciones.rellenarFilasExistentesCon);
    partes.push(
      `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY;`,
      `UPDATE ${t} SET creado_por_sistema = ${sistema}, actualizado_por_sistema = ${sistema};`,
      `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    );
  }

  for (const grupo of GRUPOS_DE_TRAZABILIDAD) {
    partes.push(
      `ALTER TABLE ${t}
         ADD CONSTRAINT ${t}_${grupo}_ck CHECK (
           num_nonnulls(${grupo}_usuario_id, ${grupo}_superadministrador_id, ${grupo}_sistema) = 1
           AND (${grupo}_equipo_id IS NULL OR ${grupo}_usuario_id IS NOT NULL)
           AND (${grupo}_sistema IS NULL OR char_length(${grupo}_sistema) BETWEEN 1 AND 100)
         ),
         ADD CONSTRAINT ${t}_${grupo}_usuario_fk
           FOREIGN KEY (${grupo}_usuario_id, ${columnaEmpresa}) REFERENCES usuario (id, empresa_id),
         ADD CONSTRAINT ${t}_${grupo}_superadministrador_fk
           FOREIGN KEY (${grupo}_superadministrador_id) REFERENCES superadministrador (id);`,
    );
  }

  partes.push(
    `CREATE TRIGGER trazabilidad BEFORE INSERT OR UPDATE ON ${t}
       FOR EACH ROW EXECUTE FUNCTION public.trazabilidad();`,
  );
  return partes.join('\n');
}

/**
 * Deshace `sqlTrazabilidad`: quita el trigger, las llaves, los `CHECK` y las columnas (incluidas las
 * llaves hacia `equipo` que haya agregado la migración de equipos, que caen con sus columnas). No toca
 * los demás datos.
 */
export function sqlQuitarTrazabilidad(tabla: string): string {
  const t = identificador(tabla);
  const columnas = GRUPOS_DE_TRAZABILIDAD.flatMap((grupo) =>
    ['usuario_id', 'equipo_id', 'superadministrador_id', 'sistema'].map(
      (sufijo) => `DROP COLUMN ${grupo}_${sufijo}`,
    ),
  );
  return [`DROP TRIGGER trazabilidad ON ${t};`, `ALTER TABLE ${t} ${columnas.join(', ')};`].join(
    '\n',
  );
}

/**
 * `sqlTablaDeEmpresa` más `sqlTrazabilidad`: toda tabla nueva con datos de clientes se crea con esta
 * función, salvo las excepciones de la lista cerrada (`auditoria`, `sesion`, `bloqueo_intentos` e
 * `idempotencia`), que usan `sqlTablaDeEmpresa` a secas. La tabla ya debe existir, vacía.
 */
export function sqlTablaDeEmpresaTrazable(tabla: string, opciones: OpcionesTablaDeEmpresa): string {
  return [
    sqlTablaDeEmpresa(tabla, opciones),
    sqlTrazabilidad(tabla, { columnaEmpresa: opciones.columnaEmpresa }),
  ].join('\n');
}
