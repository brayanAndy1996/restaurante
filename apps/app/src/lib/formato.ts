import type { Rol } from '@restaurante/dominio';

const ROLES: Record<Rol, string> = {
  MOZO: 'Mozo',
  CAJERO: 'Cajero',
  COCINA_BARRA: 'Cocina/Barra',
  SUPERVISOR: 'Supervisor',
  ADMINISTRADOR: 'Administrador',
};

/** Nombre de un rol tal como se dice en el negocio. */
export function etiquetaDeRol(rol: Rol | null | undefined): string {
  return rol ? ROLES[rol] : 'Sin sucursal';
}

/** "10/11/2026" a partir de "2026-11-10" (fecha sin hora: no pasa por zonas horarias). */
export function formatearFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "18 de noviembre de 2026". */
export function fechaLarga(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  if (!anio || !mes || !dia) return fecha;
  return `${dia} de ${MESES[mes - 1] ?? ''} de ${anio}`;
}

/** Hora de Lima ("15:40") de un instante ISO. */
export function horaDeLima(instante: string | Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(typeof instante === 'string' ? new Date(instante) : instante);
}

/** Cuenta regresiva "4:32" a partir de segundos. */
export function relojDeCuenta(segundos: number): string {
  const total = Math.max(0, Math.ceil(segundos));
  const minutos = Math.floor(total / 60);
  const resto = total % 60;
  return `${minutos}:${String(resto).padStart(2, '0')}`;
}

/** "1 sucursal", "3 sucursales". */
export function pluralSucursales(cantidad: number): string {
  return cantidad === 1 ? '1 sucursal' : `${cantidad} sucursales`;
}

/** "27/10/2026" de un instante ISO, con la fecha de Lima. */
export function fechaDeLima(instante: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(instante));
}
