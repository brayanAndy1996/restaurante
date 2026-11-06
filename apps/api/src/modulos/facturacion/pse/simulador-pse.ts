import { createHash } from 'node:crypto';
import {
  claveDeDocumentoPse,
  type ConectorPse,
  type CredencialPse,
  type DocumentoPse,
  type IdDocumentoPse,
  type ObservacionSunat,
  type ResultadoConsultaPse,
  type ResultadoPse,
} from './conector-pse';

/**
 * El PSE simulado (historia 006, entrega 6b, criterio 121; RF-66): implementa `ConectorPse` en memoria y sin red.
 * Es la herramienta de las pruebas y el modo `SIMULADO` de los emisores de demostración. Guarda cada documento
 * recibido por su `IdDocumentoPse`, responde `ACEPTADO` con código `0`, un `hash` determinado por el contenido
 * (SHA-256 en base64 del documento), un XML y un CDR de ejemplo (unos cientos de bytes que dicen "SIMULADO") y
 * `urlConsulta()` `null`. Emitir dos veces el mismo identificador no registra otro documento y devuelve el resultado
 * del primero. Nunca lanza.
 *
 * Las reglas de prueba (`reglas`) se consumen por llamada, en este orden: demora, `ERROR_CONFIGURACION`, fallo de
 * transmisión (no registra nada), y luego, ya con el documento registrado, la respuesta perdida (`ERROR_TRANSPORTE`) o
 * `PENDIENTE`. Una regla con contador (`veces`) deja de aplicar al agotarse.
 */

/** Cuántas veces se registró un documento: nunca más de 1. */
export type Recibidos = 0 | 1;

export interface LlamadaAlSimulador {
  operacion: 'emitir' | 'consultar';
  id: IdDocumentoPse;
  /** El tipo del resultado devuelto, o `NO_EXISTE` en una consulta sin documento. */
  resultado: ResultadoConsultaPse['tipo'];
}

/** Un rechazo configurado: el código y el mensaje que devuelve el simulador (origen `SUNAT`). */
export interface RechazoSimulado {
  codigo: string;
  mensaje: string;
}

const DETALLE_TRANSPORTE = 'Simulado: no hubo respuesta del PSE';
const DETALLE_CONFIGURACION = 'Simulado: credenciales del PSE inválidas';

/** Las reglas que las pruebas ponen al simulador (criterio 121). Todas son acumulables y `limpiar()` las quita. */
export class ReglasDelSimulador {
  /** @internal */ readonly rechazosPorRuc = new Map<string, RechazoSimulado>();
  /** @internal */ readonly rechazosPorNumero = new Map<string, RechazoSimulado>();
  /** @internal */ transmisionesPorFallar = 0;
  /** @internal */ respuestasPorPerder = 0;
  /** @internal */ pendientesPorResponder = 0;
  /** @internal */ errorDeConfiguracionPorResponder = 0;
  /** @internal */ demoraMs = 0;
  /** @internal */ observaciones: ObservacionSunat[] = [];

  /** Rechaza (origen `SUNAT`) todo documento cuyo cliente tenga este RUC. */
  rechazarRucDeCliente(ruc: string, rechazo: RechazoSimulado): this {
    this.rechazosPorRuc.set(ruc, rechazo);
    return this;
  }

  /** Rechaza (origen `SUNAT`) el documento de este número: `B001-00000124` (serie y 8 cifras) o `B001-124`. */
  rechazarNumero(numero: string, rechazo: RechazoSimulado): this {
    this.rechazosPorNumero.set(normalizarNumero(numero), rechazo);
    return this;
  }

  /** Las próximas `veces` llamadas (emitir o consultar) fallan con `ERROR_TRANSPORTE` sin registrar nada. */
  fallarTransmision(veces: number): this {
    this.transmisionesPorFallar = entero(veces);
    return this;
  }

  /**
   * Las próximas `veces` emisiones registran el documento y devuelven `ERROR_TRANSPORTE`: el PSE lo recibió pero la
   * respuesta se perdió.
   */
  perderRespuesta(veces: number): this {
    this.respuestasPorPerder = entero(veces);
    return this;
  }

  /** Las próximas `veces` respuestas (emitir o consultar de un documento registrado) son `PENDIENTE`. */
  responderPendiente(veces: number): this {
    this.pendientesPorResponder = entero(veces);
    return this;
  }

  /** Las próximas `veces` llamadas responden `ERROR_CONFIGURACION` (sin `veces`, todas hasta `limpiar()`). */
  errorDeConfiguracion(veces: number = Number.POSITIVE_INFINITY): this {
    this.errorDeConfiguracionPorResponder = veces;
    return this;
  }

  /** Cada llamada tarda `milisegundos` antes de responder (tiempo real). */
  demorar(milisegundos: number): this {
    this.demoraMs = entero(milisegundos);
    return this;
  }

  /** Los documentos nuevos se aceptan con estas observaciones. */
  aceptarConObservaciones(observaciones: ObservacionSunat[]): this {
    this.observaciones = observaciones.map((o) => ({ ...o }));
    return this;
  }

  /** Quita todas las reglas. */
  limpiar(): this {
    this.rechazosPorRuc.clear();
    this.rechazosPorNumero.clear();
    this.transmisionesPorFallar = 0;
    this.respuestasPorPerder = 0;
    this.pendientesPorResponder = 0;
    this.errorDeConfiguracionPorResponder = 0;
    this.demoraMs = 0;
    this.observaciones = [];
    return this;
  }
}

function entero(valor: number): number {
  if (!Number.isInteger(valor) || valor < 0) throw new RangeError('Debe ser un entero de 0 o más');
  return valor;
}

/** `B001-124` y `B001-00000124` son el mismo número. */
function normalizarNumero(numero: string): string {
  const [serie = '', correlativo = ''] = numero.split('-');
  return `${serie}-${correlativo.replace(/^0+(?=\d)/, '')}`;
}

function sinCeros(id: IdDocumentoPse): string {
  return normalizarNumero(`${id.serie}-${id.numero}`);
}

interface DocumentoGuardado {
  documento: DocumentoPse;
  /** El resultado final que el simulador da a este documento (ya decidido al registrarlo). */
  resultado: Extract<ResultadoPse, { tipo: 'ACEPTADO' | 'RECHAZADO' }>;
}

export class SimuladorPse implements ConectorPse {
  readonly reglas = new ReglasDelSimulador();
  private readonly documentos = new Map<string, DocumentoGuardado>();
  private readonly registro: LlamadaAlSimulador[] = [];

  /** Sin red: la dirección de consulta del cliente no existe (criterio 162). */
  urlConsulta(): string | null {
    return null;
  }

  async emitir(documento: DocumentoPse, credencial: CredencialPse | null): Promise<ResultadoPse> {
    void credencial;
    const previo = await this.atenderReglasDeEntrada();
    if (previo !== null) return this.anotar('emitir', documento.id, previo);
    const clave = claveDeDocumentoPse(documento.id);
    let guardado = this.documentos.get(clave);
    if (guardado === undefined) {
      guardado = { documento, resultado: this.resolver(documento) };
      this.documentos.set(clave, guardado);
    }
    if (this.reglas.respuestasPorPerder > 0) {
      this.reglas.respuestasPorPerder -= 1;
      return this.anotar('emitir', documento.id, {
        tipo: 'ERROR_TRANSPORTE',
        detalle: DETALLE_TRANSPORTE,
      });
    }
    return this.anotar('emitir', documento.id, this.respuestaDe(guardado));
  }

  async consultar(
    id: IdDocumentoPse,
    credencial: CredencialPse | null,
  ): Promise<ResultadoConsultaPse> {
    void credencial;
    const previo = await this.atenderReglasDeEntrada();
    if (previo !== null) return this.anotar('consultar', id, previo);
    const guardado = this.documentos.get(claveDeDocumentoPse(id));
    if (guardado === undefined) return this.anotar('consultar', id, { tipo: 'NO_EXISTE' });
    return this.anotar('consultar', id, this.respuestaDe(guardado));
  }

  /** Cuántas veces se registró el documento: 0 o 1 (emitir dos veces el mismo identificador no lo duplica). */
  recibidos(id: IdDocumentoPse): Recibidos {
    return this.documentos.has(claveDeDocumentoPse(id)) ? 1 : 0;
  }

  /** El documento tal como lo recibió el simulador, para comprobar su contenido; `undefined` si no llegó. */
  documentoRecibido(id: IdDocumentoPse): DocumentoPse | undefined {
    return this.documentos.get(claveDeDocumentoPse(id))?.documento;
  }

  /** Las operaciones recibidas, en orden: para comprobar «consultar antes de emitir» (criterio 128). */
  llamadas(): LlamadaAlSimulador[] {
    return this.registro.map((l) => ({ ...l, id: { ...l.id } }));
  }

  /** Olvida los documentos y las llamadas; las reglas se quitan con `reglas.limpiar()`. */
  reiniciar(): void {
    this.documentos.clear();
    this.registro.length = 0;
  }

  /** Demora, `ERROR_CONFIGURACION` y fallo de transmisión: lo que responde antes de mirar el documento. */
  private async atenderReglasDeEntrada(): Promise<ResultadoPse | null> {
    if (this.reglas.demoraMs > 0) {
      await new Promise<void>((resolver) => setTimeout(resolver, this.reglas.demoraMs));
    }
    if (this.reglas.errorDeConfiguracionPorResponder > 0) {
      this.reglas.errorDeConfiguracionPorResponder -= 1;
      return { tipo: 'ERROR_CONFIGURACION', detalle: DETALLE_CONFIGURACION };
    }
    if (this.reglas.transmisionesPorFallar > 0) {
      this.reglas.transmisionesPorFallar -= 1;
      return { tipo: 'ERROR_TRANSPORTE', detalle: DETALLE_TRANSPORTE };
    }
    return null;
  }

  /** Lo que el simulador decide de un documento nuevo: rechazo configurado o aceptación. */
  private resolver(documento: DocumentoPse): DocumentoGuardado['resultado'] {
    const rechazo =
      (documento.cliente === null
        ? undefined
        : this.reglas.rechazosPorRuc.get(documento.cliente.numero)) ??
      this.reglas.rechazosPorNumero.get(sinCeros(documento.id));
    if (rechazo !== undefined) {
      return {
        tipo: 'RECHAZADO',
        origen: 'SUNAT',
        codigo: rechazo.codigo,
        mensaje: rechazo.mensaje,
      };
    }
    const hash = createHash('sha256').update(JSON.stringify(documento)).digest('base64');
    return {
      tipo: 'ACEPTADO',
      codigoSunat: '0',
      mensaje: 'Simulado: la boleta o factura fue aceptada',
      observaciones: this.reglas.observaciones.map((o) => ({ ...o })),
      hash,
      xml: Buffer.from(archivoDeEjemplo('xml', documento.id)),
      cdr: Buffer.from(archivoDeEjemplo('cdr', documento.id)),
      referenciaPse: `SIM-${hash.slice(0, 12)}`,
    };
  }

  /** La respuesta de un documento registrado, con `PENDIENTE` si quedan por responder. */
  private respuestaDe(guardado: DocumentoGuardado): ResultadoPse {
    if (this.reglas.pendientesPorResponder > 0) {
      this.reglas.pendientesPorResponder -= 1;
      const aceptado = guardado.resultado;
      return {
        tipo: 'PENDIENTE',
        referenciaPse: aceptado.tipo === 'ACEPTADO' ? aceptado.referenciaPse : null,
      };
    }
    const resultado = guardado.resultado;
    return resultado.tipo === 'ACEPTADO'
      ? {
          ...resultado,
          observaciones: resultado.observaciones.map((o) => ({ ...o })),
          xml: resultado.xml === null ? null : Buffer.from(resultado.xml),
          cdr: resultado.cdr === null ? null : Buffer.from(resultado.cdr),
        }
      : { ...resultado };
  }

  private anotar<R extends ResultadoConsultaPse>(
    operacion: 'emitir' | 'consultar',
    id: IdDocumentoPse,
    resultado: R,
  ): R {
    this.registro.push({ operacion, id: { ...id }, resultado: resultado.tipo });
    return resultado;
  }
}

/** Unos cientos de bytes que dicen "SIMULADO" (el XML y el CDR de ejemplo). */
function archivoDeEjemplo(tipo: 'xml' | 'cdr', id: IdDocumentoPse): string {
  const cabecera = tipo === 'xml' ? '<?xml version="1.0" encoding="UTF-8"?>' : 'PK-SIMULADO';
  const cuerpo = `<Simulado>SIMULADO · SIN VALOR TRIBUTARIO · ${id.rucEmisor}-${id.tipoSunat}-${id.serie}-${id.numero}</Simulado>`;
  return `${cabecera}\n${cuerpo}\n${'SIMULADO '.repeat(30)}`;
}
