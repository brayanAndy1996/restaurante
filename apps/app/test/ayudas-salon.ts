import type { MesaDelSalon, SalonRespuesta, SesionRespuesta } from '@restaurante/contratos';
import { permisosDeRol, type Modulo, type Rol } from '@restaurante/dominio';
import { ID, sesionDe } from './ayudas';

/** Hora fija del servidor en las pruebas del salón (hora de Lima 12:00). */
export const AHORA = '2026-10-29T17:00:00.000Z';

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const Z_SALON = uuid(1);
export const Z_TERRAZA = uuid(2);

/** Sesión de un rol con el plan completo (Salón y Cocina). Quien no es Administrador tiene ese rol en la sucursal. */
export function sesionDeRol(
  rol: Rol,
  extra: { modulos?: Modulo[]; nombre?: string; id?: string } = {},
): SesionRespuesta {
  const administrador = rol === 'ADMINISTRADOR';
  return sesionDe({
    esAdministrador: administrador,
    rol: administrador ? null : rol,
    permisos: permisosDeRol(rol),
    modulos: extra.modulos ?? ['SALON', 'COCINA'],
    usuario: {
      id: extra.id ?? ID.usuario,
      nombre: extra.nombre ?? 'Marta Pérez',
      nombreUsuario: 'marta',
    },
    sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol }],
  });
}

interface OpcionesDeMesa {
  columna?: number;
  fila?: number;
  capacidad?: number;
  forma?: MesaDelSalon['forma'];
  estado?: MesaDelSalon['estado'];
  orden?: {
    id?: string;
    mozo?: string;
    comensales?: number;
    minutos?: number;
    total?: string;
    /** Nombres de todas las mesas de la cuenta, la propia incluida. */
    mesas?: { id: string; nombre: string }[];
  };
}

/** Una mesa del salón; con `orden` queda ocupada (o en pre-cuenta si se dice) desde hace `minutos`. */
export function mesa(n: number, nombre: string, opciones: OpcionesDeMesa = {}): MesaDelSalon {
  const id = uuid(100 + n);
  const o = opciones.orden;
  return {
    id,
    nombre,
    capacidad: opciones.capacidad ?? 4,
    forma: opciones.forma ?? 'CUADRADA',
    columna: opciones.columna ?? n,
    fila: opciones.fila ?? 1,
    estado: opciones.estado ?? (o ? 'OCUPADA' : 'LIBRE'),
    orden: o
      ? {
          id: o.id ?? uuid(900 + n),
          mozo: { id: uuid(800), nombre: o.mozo ?? 'Ana Ríos' },
          comensales: o.comensales ?? 3,
          abiertaEn: new Date(Date.parse(AHORA) - (o.minutos ?? 25) * 60_000).toISOString(),
          total: o.total ?? '120.00',
          mesas: o.mesas ?? [{ id, nombre }],
        }
      : null,
  };
}

export function zona(
  id: string,
  nombre: string,
  mesas: MesaDelSalon[],
  extra: { columnas?: number; filas?: number } = {},
): SalonRespuesta['zonas'][number] {
  return { id, nombre, columnas: extra.columnas ?? 3, filas: extra.filas ?? 2, mesas };
}

export function salon(zonas: SalonRespuesta['zonas']): SalonRespuesta {
  return { sucursalId: ID.sucursalA, ahora: AHORA, zonas };
}
