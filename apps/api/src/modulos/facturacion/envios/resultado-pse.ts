import {
  alertaDe,
  proximoIntento,
  type AlertaComprobante,
  type EstadoComprobante,
  type EstadoEnvioPse,
  type ResultadoEnvioPse,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { claveDeArchivoDeComprobante, type AlmacenComprobantes } from '../../../nucleo/archivos';
import type { ObservacionSunat, ResultadoConsultaPse, ResultadoPse } from '../pse/conector-pse';

/**
 * Lo que se guarda de la respuesta del PSE, una sola vez (historia 006, criterios 127 y 131; ruta crítica P7). Este
 * archivo es la tabla del criterio 127: cada `ResultadoPse` tiene su estado del comprobante, su estado del envío y sus
 * columnas, con los largos recortados. Lo llama el paso 3 del procesador, dentro de la transacción corta del worker; el
 * disparador `comprobante_transicion` de la base es la red de las transiciones.
 */

/** Largos máximos (criterio 131 y los `CHECK` de la migración 9). */
export const MAXIMO_MENSAJE = 500;
export const MAXIMO_CODIGO = 50;
export const MAXIMO_REFERENCIA = 200;
export const MAXIMO_OBSERVACIONES = 20;

/** Recorta a `maximo` caracteres (no unidades UTF-16: la base cuenta caracteres) y quita los NUL; vacío → `null`. */
export function recortar(texto: string | null | undefined, maximo: number): string | null {
  if (texto === null || texto === undefined) return null;
  const limpio = texto.replaceAll('\u0000', '');
  const caracteres = Array.from(limpio);
  const recortado = caracteres.length > maximo ? caracteres.slice(0, maximo).join('') : limpio;
  return recortado.length === 0 ? null : recortado;
}

/** Una llamada al PSE ya hecha en el paso 2; da una fila de `intento_pse` (criterio 131). */
export interface LlamadaHecha {
  operacion: 'EMITIR' | 'CONSULTAR';
  iniciadoEn: Date;
  terminadoEn: Date;
  resultado: ResultadoConsultaPse;
}

/** Las claves de los archivos que el paso 2 guardó en el almacén privado (criterio 131). */
export interface ClavesDeArchivos {
  xmlClave: string | null;
  cdrClave: string | null;
}

/** El resultado de un `ACEPTADO` con sus archivos guardados: nada se guarda fuera de lo que este tipo dice. */
export function esAceptado(
  resultado: ResultadoConsultaPse,
): resultado is Extract<ResultadoPse, { tipo: 'ACEPTADO' }> {
  return resultado.tipo === 'ACEPTADO';
}

/**
 * Guarda el XML y el CDR de un `ACEPTADO` en el almacén privado (paso 2, antes del paso 3; criterio 131): claves fijas por
 * comprobante (`comprobantes/<empresaId>/<comprobanteId>/documento.xml` y `…/cdr.zip` o `…/cdr.xml`), así que repetir
 * sobrescribe lo mismo. Sin XML o sin CDR no guarda ese archivo. Devuelve las claves.
 */
export async function guardarArchivosDeComprobante(
  almacen: AlmacenComprobantes,
  empresaId: string,
  comprobanteId: string,
  resultado: Extract<ResultadoPse, { tipo: 'ACEPTADO' }>,
): Promise<ClavesDeArchivos> {
  let xmlClave: string | null = null;
  let cdrClave: string | null = null;
  if (resultado.xml !== null) {
    xmlClave = claveDeArchivoDeComprobante(empresaId, comprobanteId, 'documento.xml');
    await almacen.guardar(xmlClave, resultado.xml, 'application/xml');
  }
  if (resultado.cdr !== null) {
    // El CDR de SUNAT es un zip; si el PSE entrega solo el XML de la constancia, se guarda como `.xml`.
    const esZip =
      resultado.cdr.length >= 2 && resultado.cdr[0] === 0x50 && resultado.cdr[1] === 0x4b;
    cdrClave = claveDeArchivoDeComprobante(empresaId, comprobanteId, esZip ? 'cdr.zip' : 'cdr.xml');
    await almacen.guardar(cdrClave, resultado.cdr, esZip ? 'application/zip' : 'application/xml');
  }
  return { xmlClave, cdrClave };
}

/** Lo que el paso 3 sabe del envío al guardar (la fila ya bloqueada con `FOR UPDATE`). */
export interface EnvioParaGuardar {
  envioId: string;
  empresaId: string;
  comprobanteId: string;
  sucursalId: string;
  /** Intentos hechos, ya contado el de este trabajo. */
  intentos: number;
  plazoHasta: Date;
  estadoComprobante: EstadoComprobante;
  emitidoEn: Date;
  /** La última alerta publicada de este comprobante. */
  alertaPublicada: AlertaComprobante | null;
}

export interface EntradaDeResultado {
  envio: EnvioParaGuardar;
  llamadas: LlamadaHecha[];
  /** El resultado final de este trabajo (el de la última llamada). */
  resultado: ResultadoPse;
  archivos: ClavesDeArchivos;
  ahora: Date;
}

export interface SalidaDeResultado {
  /** El estado del comprobante después de guardar. */
  estadoComprobante: EstadoComprobante;
  /** `true` si el estado del comprobante cambió (publica `comprobante.estado`). */
  cambioElEstado: boolean;
  estadoEnvio: EstadoEnvioPse;
  /** Cuándo toca el siguiente intento; `null` si el envío terminó o se detuvo. */
  proximoIntentoEn: Date | null;
  /** Una alerta nueva (otro motivo que el ya publicado) que hay que publicar después de confirmar; `null` si no hay. */
  alertaNueva: AlertaComprobante | null;
}

/** El resultado del PSE como el `resultado` de `intento_pse` y de `envio_pse.ultimo_resultado`. */
function nombreDeResultado(resultado: ResultadoConsultaPse): ResultadoEnvioPse | 'NO_EXISTE' {
  return resultado.tipo;
}

function codigoYMensaje(resultado: ResultadoConsultaPse): {
  codigo: string | null;
  mensaje: string | null;
} {
  switch (resultado.tipo) {
    case 'ACEPTADO':
      return {
        codigo: recortar(resultado.codigoSunat, MAXIMO_CODIGO),
        mensaje: recortar(resultado.mensaje, MAXIMO_MENSAJE),
      };
    case 'RECHAZADO':
      return {
        codigo: recortar(resultado.codigo, MAXIMO_CODIGO),
        mensaje: recortar(resultado.mensaje, MAXIMO_MENSAJE),
      };
    case 'ERROR_TRANSPORTE':
    case 'ERROR_CONFIGURACION':
      return { codigo: null, mensaje: recortar(resultado.detalle, MAXIMO_MENSAJE) };
    case 'PENDIENTE':
    case 'NO_EXISTE':
      return { codigo: null, mensaje: null };
  }
}

function observacionesRecortadas(observaciones: ObservacionSunat[]): ObservacionSunat[] {
  return observaciones.slice(0, MAXIMO_OBSERVACIONES).map((o) => ({
    codigo: recortar(o.codigo, MAXIMO_CODIGO) ?? '-',
    mensaje: recortar(o.mensaje, MAXIMO_MENSAJE) ?? '-',
  }));
}

/**
 * Aplica el resultado de un trabajo (paso 3, criterio 127): una fila `intento_pse` por cada llamada hecha, el cambio de
 * estado y las columnas del comprobante, el estado del envío con su próximo intento (`proximoIntento`) y la última alerta.
 * Corre en la transacción del worker con la fila del envío bloqueada; no publica nada (el procesador registra los efectos
 * con `alConfirmar`). Las marcas de tiempo se fijan una sola vez (`COALESCE`), como exige el disparador de la base.
 */
export async function aplicarResultado(
  conexion: Sequelize,
  entrada: EntradaDeResultado,
): Promise<SalidaDeResultado> {
  const { envio, llamadas, resultado, archivos, ahora } = entrada;
  for (const llamada of llamadas) {
    const { codigo, mensaje } = codigoYMensaje(llamada.resultado);
    await conexion.query(
      `INSERT INTO intento_pse (empresa_id, envio_id, comprobante_id, numero, operacion, iniciado_en, terminado_en,
                                resultado, codigo, mensaje, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      {
        bind: [
          envio.empresaId,
          envio.envioId,
          envio.comprobanteId,
          envio.intentos,
          llamada.operacion,
          llamada.iniciadoEn,
          llamada.terminadoEn,
          nombreDeResultado(llamada.resultado),
          codigo,
          mensaje,
          ahora,
        ],
        type: QueryTypes.INSERT,
      },
    );
  }

  let estadoComprobante = envio.estadoComprobante;
  let estadoEnvio: EstadoEnvioPse;
  let proximoIntentoEn: Date | null = null;
  let ultimoError: string | null = null;

  switch (resultado.tipo) {
    case 'ACEPTADO': {
      const cambiado = await actualizarComprobante(
        conexion,
        envio.comprobanteId,
        `estado = 'ACEPTADO', aceptado_en = $2, enviado_en = COALESCE(enviado_en, $2),
         sunat_codigo = $3, sunat_mensaje = $4, sunat_observaciones = $5::jsonb, hash = $6, referencia_pse = $7,
         xml_clave = $8, cdr_clave = $9, actualizado_en = $2`,
        [
          ahora,
          recortar(resultado.codigoSunat, MAXIMO_CODIGO),
          recortar(resultado.mensaje, MAXIMO_MENSAJE),
          JSON.stringify(observacionesRecortadas(resultado.observaciones)),
          recortar(resultado.hash, MAXIMO_REFERENCIA),
          recortar(resultado.referenciaPse, MAXIMO_REFERENCIA),
          archivos.xmlClave,
          archivos.cdrClave,
        ],
      );
      if (cambiado) estadoComprobante = 'ACEPTADO';
      estadoEnvio = 'TERMINADO';
      break;
    }
    case 'RECHAZADO': {
      // El mensaje lleva el origen (SUNAT o el PSE) para que quien lo lea sepa quién rechazó.
      const mensaje = recortar(`${resultado.origen}: ${resultado.mensaje}`, MAXIMO_MENSAJE);
      const cambiado = await actualizarComprobante(
        conexion,
        envio.comprobanteId,
        `estado = 'RECHAZADO', rechazado_en = $2, sunat_codigo = $3, sunat_mensaje = $4, actualizado_en = $2`,
        [ahora, recortar(resultado.codigo, MAXIMO_CODIGO), mensaje],
      );
      if (cambiado) estadoComprobante = 'RECHAZADO';
      estadoEnvio = 'TERMINADO';
      break;
    }
    case 'PENDIENTE': {
      const cambiado = await actualizarComprobante(
        conexion,
        envio.comprobanteId,
        `estado = 'ENVIADO', enviado_en = COALESCE(enviado_en, $2),
         referencia_pse = COALESCE($3, referencia_pse), actualizado_en = $2`,
        [ahora, recortar(resultado.referenciaPse, MAXIMO_REFERENCIA)],
      );
      if (cambiado) estadoComprobante = 'ENVIADO';
      estadoEnvio = 'ESPERANDO_RESPUESTA';
      proximoIntentoEn = proximoIntento(envio.intentos, ahora, envio.plazoHasta);
      break;
    }
    case 'ERROR_TRANSPORTE':
    case 'ERROR_CONFIGURACION':
      estadoEnvio = 'PENDIENTE';
      proximoIntentoEn = proximoIntento(envio.intentos, ahora, envio.plazoHasta);
      ultimoError = recortar(resultado.detalle, MAXIMO_MENSAJE);
      break;
  }

  // Un intento que no terminó el envío llegó a su plazo: no se reintenta solo (criterio 130).
  if (proximoIntentoEn !== null && ahora.getTime() >= envio.plazoHasta.getTime()) {
    estadoEnvio = 'DETENIDO';
    proximoIntentoEn = null;
  }

  const alerta = alertaDe(
    {
      estado: estadoComprobante,
      estadoEnvio,
      emitidoEn: envio.emitidoEn,
      ultimoResultado: resultado.tipo,
      reemplazado: false,
    },
    ahora,
  );
  const alertaNueva = alerta !== null && alerta !== envio.alertaPublicada ? alerta : null;

  await conexion.query(
    `UPDATE envio_pse
        SET estado = $2, proximo_intento_en = $3, ultimo_resultado = $4, ultimo_error = $5,
            en_curso_hasta = NULL, intento_en_curso = NULL, actualizado_en = $6,
            alertado_en = CASE WHEN $7::text IS NULL THEN alertado_en ELSE $6 END,
            alerta = COALESCE($7::text, alerta)
      WHERE id = $1`,
    {
      bind: [
        envio.envioId,
        estadoEnvio,
        proximoIntentoEn,
        resultado.tipo,
        ultimoError,
        ahora,
        alertaNueva,
      ],
      type: QueryTypes.UPDATE,
    },
  );

  return {
    estadoComprobante,
    cambioElEstado: estadoComprobante !== envio.estadoComprobante,
    estadoEnvio,
    proximoIntentoEn,
    alertaNueva,
  };
}

/**
 * `UPDATE comprobante … WHERE id = $1 AND estado IN ('POR_ENVIAR', 'ENVIADO')`: el disparador de la base es la red de las
 * transiciones, pero un comprobante que ya no está esperando respuesta no se toca. Devuelve si cambió una fila.
 */
async function actualizarComprobante(
  conexion: Sequelize,
  comprobanteId: string,
  asignaciones: string,
  valores: unknown[],
): Promise<boolean> {
  const filas = await conexion.query<{ id: string }>(
    `UPDATE comprobante SET ${asignaciones} WHERE id = $1 AND estado IN ('POR_ENVIAR', 'ENVIADO') RETURNING id`,
    { bind: [comprobanteId, ...valores], type: QueryTypes.SELECT },
  );
  return filas.length > 0;
}
