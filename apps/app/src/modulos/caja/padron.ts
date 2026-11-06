import { padronRucRespuestaSchema, type PadronRucRespuesta } from '@restaurante/contratos';
import { validarRuc } from '@restaurante/dominio';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorApi } from '../../lib/errores';
import { fechaDeLima } from '../../lib/formato';
import {
  validarCliente,
  type ClienteEscrito,
  type ErroresDeCliente,
  type ResultadoDeCliente,
} from './cobro';

/**
 * El padrón de RUC en el cliente de la factura (historia 006, entrega 6b, criterios 139 a 141 y 176): al escribir un
 * RUC válido se consulta el padrón de SUNAT y se llenan la razón social y la dirección; si el RUC no está activo, no
 * está habido o no figura, se avisa y se pide marcar «Emitir igual» antes de cobrar. El padrón es una ayuda: el cobro no
 * depende de él (el servidor no exige la marca), y si no responde se escribe a mano. El DNI y los demás documentos no
 * se consultan (criterio 141). Aquí van la llamada, las palabras de los avisos y el estado que comparten el cobro, la
 * venta de mostrador, «Emitir otro» y el cambio a factura de la nota de crédito.
 */

/** Cuánto se espera después de la última tecla antes de preguntar (el RUC completo llega con el dígito 11). */
export const ESPERA_DE_PADRON_MS = 300;
/** El padrón cambia una vez al día: no se vuelve a preguntar por el mismo RUC en un rato. */
const VIGENCIA_DE_LA_CONSULTA_MS = 10 * 60_000;

export const clavePadron = (ruc: string) => ['padron', 'ruc', ruc] as const;

/** `GET /padron/ruc/:ruc`: 404 `RUC_NO_ENCONTRADO`, 503 `PADRON_NO_DISPONIBLE`. Un solo reintento: es una ayuda. */
export const consultarPadron = (ruc: string, senal?: AbortSignal) =>
  api.get<PadronRucRespuesta>(`/padron/ruc/${ruc}`, {
    esquema: padronRucRespuestaSchema,
    reintentos: 1,
    ...(senal ? { senal } : {}),
  });

// --- Las palabras ---------------------------------------------------------------------------------------

/** «05/11»: el día de la carga del padrón, en hora de Lima. */
export function fechaDelPadron(padronAl: string): string {
  return fechaDeLima(padronAl).slice(0, 5);
}

/** Por qué el RUC lleva aviso: «Este RUC figura como BAJA DE OFICIO / NO HABIDO en el padrón de SUNAT del 05/11». */
export function tituloDelAviso(datos: PadronRucRespuesta): string {
  return `Este RUC figura como ${datos.estado} / ${datos.condicion} en el padrón de SUNAT del ${fechaDelPadron(datos.padronAl)}`;
}

/** El 404 no trae la fecha de la carga: el aviso la omite. */
export const TITULO_RUC_NO_FIGURA = 'Este RUC no figura en el padrón de SUNAT';
export const TITULO_PADRON_NO_DISPONIBLE = 'No se pudo consultar el padrón';

export const TEXTO_DE_LA_MARCA = 'Emitir igual';
export const ERROR_DE_LA_MARCA = 'Marca «Emitir igual» o corrige el RUC.';

/** Lo que dice el botón de cobrar mientras el cliente tiene errores (solo la marca, o los datos en general). */
export function motivoDelCliente(errores: ErroresDeCliente): string {
  const claves = Object.keys(errores);
  return claves.length === 1 && claves[0] === 'emitirIgual'
    ? 'Marca «Emitir igual» para usar este RUC.'
    : 'Faltan los datos del cliente.';
}

// --- El estado -------------------------------------------------------------------------------------------

export type ResultadoDelPadron =
  /** No se consulta: boleta, otro documento o un RUC que no está completo y válido. */
  | { tipo: 'ninguno' }
  | { tipo: 'consultando' }
  /** El padrón lo tiene; `aviso` es el título si no está activo o no está habido. */
  | { tipo: 'encontrado'; datos: PadronRucRespuesta; aviso: string | null }
  | { tipo: 'no_figura'; aviso: string }
  /** 503 u otra falla: se escribe a mano. */
  | { tipo: 'no_disponible' };

export interface ClienteFacturaEstado {
  resultado: ResultadoDelPadron;
  /** El RUC que lleva aviso en el padrón (o no figura) y hay que emitir «igual»; `null` si no hay aviso. */
  rucConAviso: string | null;
  emitirIgual: boolean;
  onEmitirIgual: (marcada: boolean) => void;
  /** Pregunta otra vez al padrón (cuando no se pudo consultar). */
  reconsultar: () => void;
  reconsultando: boolean;
  /** Las reglas del criterio 51 más la marca: con un aviso sin marcar no se cobra. */
  validado: ResultadoDeCliente;
}

/** El mismo valor, pero cambia `ms` después de la última vez que cambió; `null` pasa de inmediato. */
function useRetardado<T>(valor: T | null, ms: number): T | null {
  const [retardado, setRetardado] = useState<T | null>(valor);
  useEffect(() => {
    if (valor === null) {
      setRetardado(null);
      return;
    }
    const id = window.setTimeout(() => setRetardado(valor), ms);
    return () => window.clearTimeout(id);
  }, [valor, ms]);
  return valor === null ? null : retardado;
}

/** El RUC que se consulta: solo en una factura y solo cuando está completo y es válido (criterios 139 y 141). */
function rucAConsultar(tipo: 'BOLETA' | 'FACTURA', numero: string): string | null {
  return tipo === 'FACTURA' && /^\d{11}$/.test(numero) && validarRuc(numero) ? numero : null;
}

/**
 * Consulta el padrón del RUC escrito, llena la razón social y la dirección (una vez por RUC: lo que la persona corrija
 * después no se pisa) y lleva la marca «Emitir igual», que vale solo para el RUC con aviso en que se marcó.
 * `validado` es `validarCliente` con la marca: el cobro lo usa en lugar de la validación suelta.
 */
export function useClienteFactura(
  tipo: 'BOLETA' | 'FACTURA',
  total: string,
  cliente: ClienteEscrito,
  onCliente: (cliente: ClienteEscrito) => void,
): ClienteFacturaEstado {
  const escrito = rucAConsultar(tipo, cliente.numero.trim());
  const ruc = useRetardado(escrito, ESPERA_DE_PADRON_MS);
  const vigente = ruc !== null && ruc === escrito ? ruc : null;

  const consulta = useQuery({
    queryKey: clavePadron(vigente ?? ''),
    queryFn: ({ signal }) => consultarPadron(vigente ?? '', signal),
    enabled: vigente !== null,
    staleTime: VIGENCIA_DE_LA_CONSULTA_MS,
    retry: false,
  });

  let resultado: ResultadoDelPadron = { tipo: 'ninguno' };
  if (escrito !== null) {
    if (vigente === null || consulta.isPending) {
      resultado = { tipo: 'consultando' };
    } else if (consulta.data) {
      const datos = consulta.data;
      resultado = {
        tipo: 'encontrado',
        datos,
        aviso: datos.activo && datos.habido ? null : tituloDelAviso(datos),
      };
    } else if (
      consulta.error instanceof ErrorApi &&
      consulta.error.codigo === 'RUC_NO_ENCONTRADO'
    ) {
      resultado = { tipo: 'no_figura', aviso: TITULO_RUC_NO_FIGURA };
    } else {
      resultado = { tipo: 'no_disponible' };
    }
  }
  const rucConAviso =
    vigente !== null &&
    (resultado.tipo === 'no_figura' ||
      (resultado.tipo === 'encontrado' && resultado.aviso !== null))
      ? vigente
      : null;

  // La marca vale para el RUC en que se puso: otro RUC, o ninguno, la quita.
  const [marcadoPara, setMarcadoPara] = useState<string | null>(null);
  if (marcadoPara !== null && marcadoPara !== rucConAviso) setMarcadoPara(null);
  const emitirIgual = rucConAviso !== null && marcadoPara === rucConAviso;

  // Se llena una vez por RUC. Un cliente que ya trae nombre (el del rechazado) cuenta como llenado: no se pisa.
  const llenadoPara = useRef<string | null>(
    escrito !== null && cliente.nombre !== '' ? escrito : null,
  );
  useEffect(() => {
    if (escrito === null) llenadoPara.current = null;
  }, [escrito]);
  const datos = consulta.data;
  useEffect(() => {
    if (!datos || datos.ruc !== escrito || llenadoPara.current === datos.ruc) return;
    llenadoPara.current = datos.ruc;
    onCliente({
      ...cliente,
      nombre: datos.razonSocial.slice(0, 200),
      direccion: (datos.direccion ?? '').slice(0, 300),
    });
    // Solo cuando llega la respuesta de un RUC: lo que la persona escribe después no vuelve a llenarse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, escrito]);

  const base = validarCliente(tipo, total, cliente);
  const bloquea = rucConAviso !== null && !emitirIgual;
  const validado: ResultadoDeCliente = bloquea
    ? { ok: false, errores: { ...(base.ok ? {} : base.errores), emitirIgual: ERROR_DE_LA_MARCA } }
    : base;

  return {
    resultado,
    rucConAviso,
    emitirIgual,
    onEmitirIgual: (marcada) => setMarcadoPara(marcada ? rucConAviso : null),
    reconsultar: () => void consulta.refetch(),
    reconsultando: consulta.isFetching,
    validado,
  };
}
