import type { PlanCrearEntrada, PlanModificarEntrada, PlanRespuesta } from '@restaurante/contratos';
import { MODULOS, type Modulo } from '@restaurante/dominio';
import { largo, validarMotivo, validarTexto, type Errores } from './empresa-form';

export interface PlanForm {
  codigo: string;
  nombre: string;
  precioMensual: string;
  cuotaComprobantesMes: string;
  precioExcedente: string;
  diasGracia: string;
  modulos: Record<Modulo, boolean>;
  porDefecto: boolean;
  activo: boolean;
  motivo: string;
}

export function planVacio(): PlanForm {
  return {
    codigo: '',
    nombre: '',
    precioMensual: '',
    cuotaComprobantesMes: '',
    precioExcedente: '',
    diasGracia: '7',
    modulos: Object.fromEntries(MODULOS.map((m) => [m, true])) as Record<Modulo, boolean>,
    porDefecto: false,
    activo: true,
    motivo: '',
  };
}

export function formularioDePlan(plan: PlanRespuesta): PlanForm {
  return {
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioMensual: plan.precioMensual ?? '',
    cuotaComprobantesMes:
      plan.cuotaComprobantesMes === null ? '' : String(plan.cuotaComprobantesMes),
    precioExcedente: plan.precioExcedente ?? '',
    diasGracia: String(plan.diasGracia),
    modulos: Object.fromEntries(MODULOS.map((m) => [m, plan.modulos.includes(m)])) as Record<
      Modulo,
      boolean
    >,
    porDefecto: plan.porDefecto,
    activo: plan.activo,
    motivo: '',
  };
}

const modulosElegidos = (f: PlanForm): Modulo[] => MODULOS.filter((m) => f.modulos[m]);

/** Texto decimal sin espacios, con "," o "." como separador; vacío es "sin definir". */
const decimal = (texto: string) => texto.trim().replace(',', '.');

export function validarPlan(f: PlanForm): Errores {
  const errores: Errores = {};
  const codigo = validarTexto(f.codigo, 30, 'Escribe el código del plan');
  if (codigo) errores.codigo = codigo;
  const nombre = validarTexto(f.nombre, 100, 'Escribe el nombre del plan');
  if (nombre) errores.nombre = nombre;
  const precio = decimal(f.precioMensual);
  if (precio !== '' && !/^\d{1,8}(\.\d{1,2})?$/.test(precio))
    errores.precioMensual = 'Escribe soles con hasta 2 decimales (120.00) o déjalo vacío';
  const cuota = f.cuotaComprobantesMes.trim();
  if (cuota !== '' && !/^\d{1,9}$/.test(cuota))
    errores.cuotaComprobantesMes = 'Escribe un número entero (0 o más) o déjalo vacío';
  const excedente = decimal(f.precioExcedente);
  if (excedente !== '' && !/^\d{1,6}(\.\d{1,4})?$/.test(excedente))
    errores.precioExcedente = 'Escribe soles con hasta 4 decimales (0.0500) o déjalo vacío';
  const dias = f.diasGracia.trim();
  if (!/^\d{1,2}$/.test(dias) || Number(dias) > 60)
    errores.diasGracia = 'Escribe un número entero de 0 a 60';
  if (f.porDefecto && !f.activo) errores.activo = 'El plan por defecto debe estar activo';
  const motivo = validarMotivo(f.motivo);
  if (motivo) errores.motivo = motivo;
  if (largo(f.codigo.trim()) > 30) errores.codigo = 'Usa 30 caracteres como máximo';
  return errores;
}

function valoresDelPlan(f: PlanForm) {
  const precio = decimal(f.precioMensual);
  const cuota = f.cuotaComprobantesMes.trim();
  const excedente = decimal(f.precioExcedente);
  return {
    codigo: f.codigo.trim(),
    nombre: f.nombre.trim(),
    precioMensual: precio === '' ? null : precio,
    cuotaComprobantesMes: cuota === '' ? null : Number(cuota),
    precioExcedente: excedente === '' ? null : excedente,
    diasGracia: Number(f.diasGracia.trim()),
    modulos: modulosElegidos(f),
    porDefecto: f.porDefecto,
    activo: f.activo,
  };
}

export function entradaDePlan(f: PlanForm): PlanCrearEntrada {
  return { ...valoresDelPlan(f), motivo: f.motivo.trim() };
}

/** Solo lo que cambió respecto del plan guardado (`PATCH`), más el motivo. */
export function cambiosDelPlan(original: PlanRespuesta, f: PlanForm): PlanModificarEntrada {
  const nuevo = valoresDelPlan(f);
  const cambios: PlanModificarEntrada = { motivo: f.motivo.trim() };
  if (nuevo.codigo !== original.codigo) cambios.codigo = nuevo.codigo;
  if (nuevo.nombre !== original.nombre) cambios.nombre = nuevo.nombre;
  if (nuevo.precioMensual !== original.precioMensual) cambios.precioMensual = nuevo.precioMensual;
  if (nuevo.cuotaComprobantesMes !== original.cuotaComprobantesMes)
    cambios.cuotaComprobantesMes = nuevo.cuotaComprobantesMes;
  if (nuevo.precioExcedente !== original.precioExcedente)
    cambios.precioExcedente = nuevo.precioExcedente;
  if (nuevo.diasGracia !== original.diasGracia) cambios.diasGracia = nuevo.diasGracia;
  if (
    nuevo.modulos.join() !==
    [...original.modulos].sort((a, b) => MODULOS.indexOf(a) - MODULOS.indexOf(b)).join()
  )
    cambios.modulos = nuevo.modulos;
  if (nuevo.porDefecto !== original.porDefecto) cambios.porDefecto = nuevo.porDefecto;
  if (nuevo.activo !== original.activo) cambios.activo = nuevo.activo;
  return cambios;
}

/** `true` si hay algo más que el motivo. */
export function hayCambiosDePlan(cambios: PlanModificarEntrada): boolean {
  return Object.keys(cambios).some((k) => k !== 'motivo');
}
