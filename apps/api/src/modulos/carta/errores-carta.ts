import type { CampoError, SeQuita, UsadoEn } from '@restaurante/contratos';
import type { ErrorSeleccion, MotivoNoVendible } from '@restaurante/dominio';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa y uno inexistente dan exactamente el mismo
 * cuerpo (criterio 67): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 422 por una referencia (id) que no existe en la empresa, de otra empresa o inactiva (criterio 9). */
export const referenciaInvalida = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    campos,
  );

/** 400 por una regla del criterio 7 o una lista de orden que no cumple (criterios 5 y 13). */
export const datosInvalidos = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', campos);

/** 409 por un nombre repetido (índice único por `lower(nombre)`). */
export const nombreRepetido = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', `Ya existe ${que} con ese nombre`, [
    { campo: 'nombre', mensaje: 'Ya existe uno con ese nombre' },
  ]);

/** 409 al desactivar algo que usan productos activos (criterios 2 y 4). */
export const enUso = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'EN_USO', mensaje);

/** 422 de la foto (criterio 14). */
export const fotoInvalida = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'FOTO_INVALIDA', mensaje);

/** 409 por un conflicto con lo guardado que no es un nombre repetido (criterio 10d). */
export const conflicto = (mensaje: string, campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje, campos);

/**
 * 409 `EN_USO` de un cambio de tipo (criterio 10c): el producto es componente de un combo o producto ligado de
 * un modificador, así que no puede pasar a `COMBO` ni a `MENU_DEL_DIA`. Lleva `usadoEn` y dice dónde se usa.
 */
export const enUsoPorCambioDeTipo = (mensaje: string, usadoEn: UsadoEn): ErrorAplicacion =>
  new ErrorAplicacion(409, 'EN_USO', mensaje, undefined, undefined, { usadoEn });

/** 409 `CONFIRMACION_REQUERIDA` (criterio 10b): el cambio de tipo quitaría algo; lleva `seQuita`. */
export const confirmacionRequerida = (mensaje: string, seQuita: SeQuita): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFIRMACION_REQUERIDA', mensaje, undefined, undefined, { seQuita });

/** Por qué `prepararLinea` rechaza un producto: un motivo de `vendibilidad` o que no se vende solo. */
export type MotivoDeRechazo = MotivoNoVendible | 'NO_SE_VENDE_SOLO';

const MENSAJES_DE_MOTIVO: Record<MotivoDeRechazo, string> = {
  INACTIVO: 'El producto está desactivado',
  NO_DISPONIBLE: 'El producto no está disponible en esta sucursal',
  AGOTADO: 'El producto está agotado',
  COMPONENTE_NO_DISPONIBLE: 'Un componente del producto no está disponible',
  MENU_SIN_ARMAR: 'El menú del día no está armado',
  OPCIONES_INSUFICIENTES: 'No hay suficientes opciones disponibles',
  NO_SE_VENDE_SOLO: 'El producto no se vende solo',
};

/**
 * 422 `PRODUCTO_NO_VENDIBLE` de `prepararLinea` (criterio 52). El motivo viaja en `motivo` (para quien llama
 * desde el código, como la sección 3) y en `campos` (`productoId` con el código del motivo como mensaje).
 */
export class ErrorProductoNoVendible extends ErrorAplicacion {
  constructor(readonly motivo: MotivoDeRechazo) {
    super(422, 'PRODUCTO_NO_VENDIBLE', MENSAJES_DE_MOTIVO[motivo], [
      { campo: 'productoId', mensaje: motivo },
    ]);
  }
}

/**
 * 422 `SELECCION_INVALIDA` de `prepararLinea` (criterio 52). Los errores de `validarSeleccion` viajan tal
 * cual en `errores` y en `campos` (`modificadorIds` o `grupos.<id>`, con el código como mensaje).
 */
export class ErrorSeleccionInvalida extends ErrorAplicacion {
  constructor(readonly errores: readonly ErrorSeleccion[]) {
    super(
      422,
      'SELECCION_INVALIDA',
      'La selección de modificadores no es válida',
      errores.map((e): CampoError =>
        'modificadorId' in e
          ? { campo: 'modificadorIds', mensaje: `${e.codigo}: ${e.modificadorId}` }
          : { campo: `grupos.${e.grupoId}`, mensaje: e.codigo },
      ),
    );
  }
}
