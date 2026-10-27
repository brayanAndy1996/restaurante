import type { AltaEmpresaEntrada } from '@restaurante/contratos';
import { REGIMENES_TRIBUTARIOS, validarRuc, type RegimenTributario } from '@restaurante/dominio';

/** Errores por campo, con la misma ruta que usa la API (`sucursales.0.nombre`). */
export type Errores = Record<string, string>;

let contador = 0;
/** Identificador local de un emisor o sucursal en el formulario (no viaja a la API). */
export function idLocal(): string {
  contador += 1;
  return `l${contador}`;
}

export interface EmisorForm {
  id: string;
  ruc: string;
  razonSocial: string;
  regimen: RegimenTributario | '';
}

export interface SucursalForm {
  id: string;
  nombre: string;
  /** `id` del emisor de este formulario. */
  emisorId: string;
  codigoEstablecimiento: string;
  direccion: string;
  whatsapp: string;
  /** Vacío = plan por defecto. */
  planId: string;
  /** Vacío = un mes desde hoy. */
  vencimiento: string;
}

export interface AltaForm {
  nombre: string;
  emisores: EmisorForm[];
  sucursales: SucursalForm[];
  administrador: { nombre: string; nombreUsuario: string; contrasenaTemporal: string };
  motivo: string;
}

export const REGIMENES = REGIMENES_TRIBUTARIOS;

export function emisorVacio(): EmisorForm {
  return { id: idLocal(), ruc: '', razonSocial: '', regimen: '' };
}

export function sucursalVacia(emisorId = ''): SucursalForm {
  return {
    id: idLocal(),
    nombre: '',
    emisorId,
    codigoEstablecimiento: '0001',
    direccion: '',
    whatsapp: '',
    planId: '',
    vencimiento: '',
  };
}

export function altaVacia(): AltaForm {
  const emisor = emisorVacio();
  return {
    nombre: '',
    emisores: [emisor],
    sucursales: [sucursalVacia(emisor.id)],
    administrador: { nombre: '', nombreUsuario: '', contrasenaTemporal: '' },
    motivo: '',
  };
}

const FORMATO_NOMBRE_USUARIO = /^[a-z0-9._-]{3,50}$/;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Cantidad de caracteres (puntos de código, no unidades UTF-16). */
export const largo = (texto: string): number => Array.from(texto).length;

/** Texto obligatorio de hasta `max` caracteres (ya recortado). */
export function validarTexto(valor: string, max: number, vacio: string): string | undefined {
  const t = valor.trim();
  if (t === '') return vacio;
  if (largo(t) > max) return `Usa ${max} caracteres como máximo`;
  return undefined;
}

export function validarEmisor(
  e: Pick<EmisorForm, 'ruc' | 'razonSocial' | 'regimen'>,
  prefijo: string,
): Errores {
  const errores: Errores = {};
  const ruc = e.ruc.trim();
  if (ruc === '') errores[`${prefijo}ruc`] = 'Escribe el RUC';
  else if (!validarRuc(ruc))
    errores[`${prefijo}ruc`] =
      'El RUC no es válido: son 11 dígitos y empieza con 10, 15, 16, 17 o 20';
  const razon = validarTexto(e.razonSocial, 200, 'Escribe la razón social');
  if (razon) errores[`${prefijo}razonSocial`] = razon;
  if (e.regimen === '') errores[`${prefijo}regimen`] = 'Elige el régimen tributario';
  return errores;
}

export function validarSucursal(
  s: Pick<
    SucursalForm,
    'nombre' | 'codigoEstablecimiento' | 'direccion' | 'whatsapp' | 'vencimiento'
  >,
  prefijo: string,
  hoy: string,
): Errores {
  const errores: Errores = {};
  const nombre = validarTexto(s.nombre, 100, 'Escribe el nombre de la sucursal');
  if (nombre) errores[`${prefijo}nombre`] = nombre;
  if (!/^\d{4}$/.test(s.codigoEstablecimiento.trim()))
    errores[`${prefijo}codigoEstablecimiento`] = 'Son 4 dígitos, por ejemplo 0001';
  const direccion = validarTexto(s.direccion, 300, 'Escribe la dirección');
  if (direccion) errores[`${prefijo}direccion`] = direccion;
  const whatsapp = s.whatsapp.trim();
  if (whatsapp !== '' && !/^\+519\d{8}$/.test(whatsapp))
    errores[`${prefijo}whatsapp`] = 'Usa el formato +519XXXXXXXX';
  const vencimiento = validarFechaOpcional(s.vencimiento, hoy);
  if (vencimiento) errores[`${prefijo}suscripcion.vencimiento`] = vencimiento;
  return errores;
}

/** Fecha que existe en el calendario y no es anterior a hoy; vacía es válida. */
export function validarFechaOpcional(valor: string, hoy: string): string | undefined {
  const fecha = valor.trim();
  if (fecha === '') return undefined;
  if (!FORMATO_FECHA.test(fecha)) return 'Elige una fecha válida';
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const real = new Date(Date.UTC(anio, mes - 1, dia));
  if (real.getUTCFullYear() !== anio || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== dia)
    return 'Esa fecha no existe';
  if (fecha < hoy) return 'No puede ser anterior a hoy';
  return undefined;
}

export function validarMotivo(motivo: string): string | undefined {
  return validarTexto(motivo, 300, 'Escribe el motivo: queda en la auditoría');
}

export function validarAlta(form: AltaForm, hoy: string): Errores {
  const errores: Errores = {};
  const nombre = validarTexto(form.nombre, 150, 'Escribe el nombre de la empresa');
  if (nombre) errores.nombre = nombre;

  const rucs = new Map<string, number>();
  form.emisores.forEach((e, i) => {
    Object.assign(errores, validarEmisor(e, `emisores.${i}.`));
    const ruc = e.ruc.trim();
    if (ruc !== '' && !errores[`emisores.${i}.ruc`]) {
      if (rucs.has(ruc)) errores[`emisores.${i}.ruc`] = 'Este RUC ya está en la lista';
      rucs.set(ruc, i);
    }
  });

  const codigos = new Set<string>();
  const nombres = new Set<string>();
  form.sucursales.forEach((s, i) => {
    Object.assign(errores, validarSucursal(s, `sucursales.${i}.`, hoy));
    const emisor = form.emisores.find((e) => e.id === s.emisorId);
    if (!emisor) errores[`sucursales.${i}.rucEmisor`] = 'Elige el emisor de la sucursal';
    const clave = `${emisor?.ruc.trim() ?? ''}/${s.codigoEstablecimiento.trim()}`;
    if (emisor && !errores[`sucursales.${i}.codigoEstablecimiento`]) {
      if (codigos.has(clave))
        errores[`sucursales.${i}.codigoEstablecimiento`] =
          'Este emisor ya tiene una sucursal con ese código';
      codigos.add(clave);
    }
    const n = s.nombre.trim().toLowerCase();
    if (n !== '' && !errores[`sucursales.${i}.nombre`]) {
      if (nombres.has(n)) errores[`sucursales.${i}.nombre`] = 'Ya hay una sucursal con este nombre';
      nombres.add(n);
    }
  });

  const a = form.administrador;
  const nombreAdmin = validarTexto(a.nombre, 100, 'Escribe el nombre del administrador');
  if (nombreAdmin) errores['administrador.nombre'] = nombreAdmin;
  const usuario = a.nombreUsuario.trim().toLowerCase();
  if (usuario === '') errores['administrador.nombreUsuario'] = 'Escribe un nombre de usuario';
  else if (!FORMATO_NOMBRE_USUARIO.test(usuario))
    errores['administrador.nombreUsuario'] =
      'Usa de 3 a 50 caracteres: letras, números, punto, guion o guion bajo';
  const n = largo(a.contrasenaTemporal);
  if (n === 0)
    errores['administrador.contrasenaTemporal'] = 'Escribe una contraseña temporal o genera una';
  else if (n < 8) errores['administrador.contrasenaTemporal'] = 'Usa al menos 8 caracteres';
  else if (n > 128) errores['administrador.contrasenaTemporal'] = 'Usa 128 caracteres como máximo';

  const motivo = validarMotivo(form.motivo);
  if (motivo) errores.motivo = motivo;
  return errores;
}

/** La entrada del alta tal como la espera la API (`altaEmpresaEntradaSchema`). */
export function entradaDeAlta(form: AltaForm): AltaEmpresaEntrada {
  return {
    nombre: form.nombre.trim(),
    emisores: form.emisores.map((e) => ({
      ruc: e.ruc.trim(),
      razonSocial: e.razonSocial.trim(),
      regimen: e.regimen as RegimenTributario,
    })),
    sucursales: form.sucursales.map((s) => {
      const emisor = form.emisores.find((e) => e.id === s.emisorId);
      const whatsapp = s.whatsapp.trim();
      const suscripcion = {
        ...(s.planId ? { planId: s.planId } : {}),
        ...(s.vencimiento.trim() ? { vencimiento: s.vencimiento.trim() } : {}),
      };
      return {
        rucEmisor: emisor?.ruc.trim() ?? '',
        nombre: s.nombre.trim(),
        codigoEstablecimiento: s.codigoEstablecimiento.trim(),
        direccion: s.direccion.trim(),
        ...(whatsapp ? { whatsapp } : {}),
        ...(Object.keys(suscripcion).length > 0 ? { suscripcion } : {}),
      };
    }),
    administrador: {
      nombre: form.administrador.nombre.trim(),
      nombreUsuario: form.administrador.nombreUsuario.trim().toLowerCase(),
      contrasenaTemporal: form.administrador.contrasenaTemporal,
    },
    motivo: form.motivo.trim(),
  };
}
