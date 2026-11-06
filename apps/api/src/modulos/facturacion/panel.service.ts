import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import type {
  AlertasRespuesta,
  ComprobanteDetalle,
  EnlaceComprobanteRespuesta,
  EnvioPseRespuesta,
  PanelComprobantes,
  PanelConsultaValidada,
  PanelItem,
} from '@restaurante/contratos';
import {
  ESTADOS_COMPROBANTE,
  fechaLima,
  type AlertaComprobante,
  type EstadoComprobante,
  type TipoDocumentoElectronico,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { Logger } from '@nestjs/common';
import { DIAS_ENLACE_COMPROBANTE } from '@restaurante/dominio';
import { ENTORNO, type Entorno } from '../../config/entorno';
import {
  ALMACEN_COMPROBANTES,
  esClaveDelPdfDe,
  type AlmacenComprobantes,
} from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { EmisoresService } from '../plataforma';
import { ResolutorDeAlcanceDelPanel, type AlcanceDelPanel } from './alcance-del-panel';
import { ComprobantesService } from './comprobantes.service';
import { contarAlertas, sqlAlerta } from './envios/alertas-sql';
import { COLUMNAS_ENVIO, envioRespuestaDe, type FilaDeEnvio } from './envios/envio-respuesta';
import { EnviosService } from './envios/envios.service';
import { RegistroIdsDeNotas } from './impresora-de-caja';
import { leerComprobante, textoDelNumero } from './lectura-comprobante';
import { EnlacesComprobante } from './enlaces';
import { comprobanteNoEncontrado, pdfNoDisponible } from './errores-facturacion';

/** Comprobantes por página del panel (criterio 135). */
export const COMPROBANTES_POR_PAGINA = 50;
/** El rango máximo de fechas de emisión del panel, en días (criterio 135). */
export const DIAS_MAXIMOS_DEL_PANEL = 93;
/** Los días que cubre el panel cuando no se piden fechas: hoy y los 6 anteriores (criterio 135). */
const DIAS_POR_DEFECTO = 7;
const MS_POR_DIA = 24 * 60 * 60_000;

interface FilaDelPanel extends FilaDeEnvio {
  id: string;
  tipo: TipoDocumentoElectronico;
  serie: string;
  numero: number;
  estado: EstadoComprobante;
  simulado: boolean;
  total: string;
  fecha_emision: string;
  emitido_en: Date;
  cursor_t: string;
  cliente_nombre: string | null;
  sucursal_id: string;
  sucursal_nombre: string;
  alerta: AlertaComprobante | null;
  sunat_codigo: string | null;
  sunat_mensaje: string | null;
  afecta_id: string | null;
  afecta_serie: string | null;
  afecta_numero: number | null;
  reemplaza_id: string | null;
  reemplaza_serie: string | null;
  reemplaza_numero: number | null;
  reemplazado_id: string | null;
  reemplazado_serie: string | null;
  reemplazado_numero: number | null;
}

const datosInvalidos = (campo: string, mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', mensaje, [{ campo, mensaje }]);

/** `AAAA-MM-DD` más `dias` días (puede ser negativo). */
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const diasEntre = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_POR_DIA);

interface Cursor {
  t: string;
  i: string;
}

const codificarCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/** `AAAA-MM-DDTHH:MM:SS.ffffffZ` con una fecha y una hora que existen (no mes 13, ni 30 de febrero, ni las 99:99). */
function esInstanteReal(texto: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia, hora, minuto, segundo] = partes.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto, segundo));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia &&
    fecha.getUTCHours() === hora &&
    fecha.getUTCMinutes() === minuto &&
    fecha.getUTCSeconds() === segundo
  );
}

function decodificarCursor(texto: string): Cursor {
  try {
    const dato = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof dato.t === 'string' &&
      esInstanteReal(dato.t) &&
      typeof dato.i === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(dato.i)
    ) {
      return { t: dato.t, i: dato.i };
    }
  } catch {
    // Se trata igual que un cursor mal formado.
  }
  throw datosInvalidos('cursor', 'El cursor no es válido');
}

/** `B001-00000124` o `B001-124`: serie (4 caracteres) y número; cualquier otro texto es un documento de cliente. */
function numeroDeTexto(texto: string): { serie: string; numero: number } | null {
  const partes = /^([A-Za-z][A-Za-z0-9]{3})-(\d{1,8})$/.exec(texto);
  if (partes === null) return null;
  const numero = Number(partes[2]);
  return numero >= 1 ? { serie: partes[1]!.toUpperCase(), numero } : null;
}

const referencia = (
  id: string | null,
  serie: string | null,
  numero: number | null,
): { id: string; numero: string } | null =>
  id === null ? null : { id, numero: textoDelNumero(serie!, numero!) };

/**
 * El panel de comprobantes y sus acciones (historia 006, entrega 6b, criterios 132, 133, 135, 159 y 160): lista con
 * filtros y conteos, detalle con el envío y los intentos, reintento manual, alertas, PDF y enlace. El alcance es el del
 * criterio 169 (Cajero: sus turnos; Supervisor: la sucursal activa; Administrador: sus sucursales). Solo lee las tablas de
 * facturación (`comprobante`, `envio_pse`, `intento_pse`) y pide a seguridad y plataforma lo que no es suyo.
 */
@Injectable()
export class PanelService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ResolutorDeAlcanceDelPanel) private readonly alcance: ResolutorDeAlcanceDelPanel,
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
    @Inject(EnviosService) private readonly envios: EnviosService,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(ALMACEN_COMPROBANTES) private readonly almacen: AlmacenComprobantes,
    @Inject(EnlacesComprobante) private readonly enlaces: EnlacesComprobante,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(RegistroIdsDeNotas) private readonly idsDeNotas: RegistroIdsDeNotas,
  ) {}

  private readonly logger = new Logger(PanelService.name);

  /** `GET /facturacion/comprobantes` (criterio 135). */
  async listar(consulta: PanelConsultaValidada): Promise<PanelComprobantes> {
    const ahora = this.reloj.ahora();
    const alcance = await this.alcance.resolver(consulta.sucursalId);
    const hoy = fechaLima(ahora);
    let desde = consulta.desde;
    let hasta = consulta.hasta;
    if (desde === undefined && hasta === undefined) {
      hasta = hoy;
      desde = sumarDias(hoy, -(DIAS_POR_DEFECTO - 1));
    } else if (desde === undefined) {
      desde = sumarDias(hasta!, -(DIAS_POR_DEFECTO - 1));
    } else if (hasta === undefined) {
      hasta = desde > hoy ? desde : hoy;
    }
    if (desde > hasta!) throw datosInvalidos('desde', 'La fecha inicial es posterior a la final');
    if (diasEntre(desde, hasta!) + 1 > DIAS_MAXIMOS_DEL_PANEL) {
      throw datosInvalidos('hasta', `El rango no puede pasar de ${DIAS_MAXIMOS_DEL_PANEL} días`);
    }
    const cursor = consulta.cursor === undefined ? null : decodificarCursor(consulta.cursor);
    const texto = consulta.texto?.trim();
    const numero = texto === undefined ? null : numeroDeTexto(texto);

    // Los filtros, sin el estado ni el cursor: los conteos usan estos y la lista les suma el estado y el cursor.
    const bind: unknown[] = [
      [...alcance.sucursales],
      alcance.responsableId,
      desde,
      hasta,
      consulta.tipo ?? null,
      texto === undefined || texto === '' ? null : texto,
      numero?.serie ?? null,
      numero?.numero ?? null,
      ahora,
    ];
    const filtros = `c.sucursal_id = ANY($1::uuid[])
          AND ($2::uuid IS NULL OR c.turno_responsable_id = $2::uuid)
          AND c.fecha_emision BETWEEN $3::date AND $4::date
          AND ($5::text IS NULL OR c.tipo = $5::text)
          AND ($6::text IS NULL OR c.cliente_numero = $6::text
               OR ($7::text IS NOT NULL AND c.serie = $7::text AND c.numero = $8::integer))
          ${consulta.alerta === true ? `AND ${sqlAlerta('$9')} IS NOT NULL` : ''}`;
    // `$9` (el instante) solo se usa con `alerta=true` y en la lista; se declara siempre para no cambiar los números.
    const conteoFilas = await this.conexion.query<{ estado: EstadoComprobante; n: number }>(
      `SELECT c.estado, count(*)::int AS n
         FROM comprobante c LEFT JOIN envio_pse e ON e.comprobante_id = c.id
        WHERE ${filtros} AND $9::timestamptz IS NOT NULL
        GROUP BY c.estado`,
      { bind, type: QueryTypes.SELECT },
    );
    const conteos = Object.fromEntries(
      ESTADOS_COMPROBANTE.map((estado) => [
        estado,
        conteoFilas.find((f) => f.estado === estado)?.n ?? 0,
      ]),
    ) as PanelComprobantes['conteos'];

    const bindLista = [...bind, consulta.estado ?? null, cursor?.t ?? null, cursor?.i ?? null];
    const filas = await this.conexion.query<FilaDelPanel>(
      `SELECT c.id, c.tipo, c.serie, c.numero, c.estado, c.simulado, c.total::text AS total,
              to_char(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, c.emitido_en,
              to_char(c.emitido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_t,
              c.cliente_nombre, c.sucursal_id, c.sucursal->>'nombre' AS sucursal_nombre,
              ${sqlAlerta('$9')} AS alerta,
              ${COLUMNAS_ENVIO},
              c.sunat_codigo, c.sunat_mensaje,
              a.id AS afecta_id, a.serie AS afecta_serie, a.numero AS afecta_numero,
              r.id AS reemplaza_id, r.serie AS reemplaza_serie, r.numero AS reemplaza_numero,
              p.id AS reemplazado_id, p.serie AS reemplazado_serie, p.numero AS reemplazado_numero
         FROM comprobante c
         LEFT JOIN envio_pse e ON e.comprobante_id = c.id
         LEFT JOIN comprobante a ON a.id = c.afecta_a_id
         LEFT JOIN comprobante r ON r.id = c.reemplaza_a_id
         LEFT JOIN comprobante p ON p.reemplaza_a_id = c.id
        WHERE ${filtros}
          AND ($10::text[] IS NULL OR c.estado = ANY($10::text[]))
          AND ($11::timestamptz IS NULL OR (c.emitido_en, c.id) < ($11::timestamptz, $12::uuid))
        ORDER BY c.emitido_en DESC, c.id DESC
        LIMIT ${COMPROBANTES_POR_PAGINA + 1}`,
      { bind: bindLista, type: QueryTypes.SELECT },
    );
    const pagina = filas.slice(0, COMPROBANTES_POR_PAGINA);
    const ultima = pagina.at(-1);
    return {
      conteos,
      items: pagina.map(itemDelPanel),
      siguiente:
        filas.length > COMPROBANTES_POR_PAGINA && ultima !== undefined
          ? codificarCursor({ t: ultima.cursor_t, i: ultima.id })
          : null,
    };
  }

  /** `GET /facturacion/comprobantes/:id` (criterio 135): el comprobante con su envío y hasta 50 intentos. */
  async detalle(id: string): Promise<ComprobanteDetalle> {
    await this.comprobantes.exigirVisible(id);
    const comprobanteId = id.toLowerCase();
    const comprobante = await leerComprobante(this.conexion, comprobanteId, this.idsDeNotas);
    if (comprobante === null) throw comprobanteNoEncontrado();
    return {
      ...comprobante,
      envio: await this.envios.envioDe(comprobanteId),
      intentos: await this.envios.intentosDe(comprobanteId),
    };
  }

  /** `POST /facturacion/comprobantes/:id/reintento` (criterio 132). */
  async reintentar(id: string): Promise<EnvioPseRespuesta> {
    await this.comprobantes.exigirVisible(id);
    return this.envios.reintentar(id.toLowerCase());
  }

  /** `GET /facturacion/alertas` (criterio 133): los conteos del alcance de quien pide y si hay un emisor en `SIMULADO`. */
  async alertas(sucursalId: string | undefined): Promise<AlertasRespuesta> {
    const alcance: AlcanceDelPanel = await this.alcance.resolver(sucursalId);
    const conteo = await contarAlertas(this.conexion, this.reloj.ahora(), {
      sucursales: alcance.sucursales,
      responsableId: alcance.responsableId,
    });
    return {
      ...conteo,
      modoSimulado: await this.emisores.hayModoSimulado(alcance.sucursales),
    };
  }

  /**
   * `GET /facturacion/comprobantes/:id/pdf` (criterio 159): el PDF guardado al aceptarse el comprobante, inline y con el
   * número como nombre (`B001-00000124.pdf`). Con la visibilidad del criterio 169 (404 y 403 antes que nada); 409
   * `PDF_NO_DISPONIBLE` si el comprobante no está `ACEPTADO` ni `ANULADO`, o si todavía no tiene PDF (el barrido lo arma).
   */
  async pdf(id: string): Promise<StreamableFile> {
    await this.comprobantes.exigirVisible(id);
    const { numero, clave } = await this.archivoDelPdf(id.toLowerCase());
    const contenido = await this.almacen.leer(clave);
    if (contenido === null) {
      // La fila dice que hay PDF pero el archivo no está: no se inventa otro, se avisa y se deja la huella en el registro.
      this.logger.error(JSON.stringify({ evento: 'pdf.archivo_perdido', comprobanteId: id }));
      throw pdfNoDisponible(
        'El PDF no está disponible en este momento; inténtalo de nuevo más tarde',
      );
    }
    return new StreamableFile(contenido, {
      type: 'application/pdf',
      disposition: `inline; filename="${numero}.pdf"`,
      length: contenido.length,
    });
  }

  /**
   * `GET /facturacion/comprobantes/:id/enlace` (criterio 160): `{ url, expiraEn }` con `url` =
   * `<API_URL_PUBLICA>/publico/comprobantes/<sello>` y vencimiento a `DIAS_ENLACE_COMPROBANTE` días del reloj de la API.
   * Solo con el PDF disponible (409 `PDF_NO_DISPONIBLE` si no). Cada llamada da un sello nuevo; ninguno se guarda.
   */
  async enlace(id: string): Promise<EnlaceComprobanteRespuesta> {
    await this.comprobantes.exigirVisible(id);
    const comprobanteId = id.toLowerCase();
    await this.archivoDelPdf(comprobanteId);
    const expiraEn = new Date(this.reloj.ahora().getTime() + DIAS_ENLACE_COMPROBANTE * MS_POR_DIA);
    const sello = this.enlaces.sellar({
      empresaId: this.contexto.empresaActual(),
      comprobanteId,
      expiraEn,
    });
    const base = this.entorno.API_URL_PUBLICA;
    if (base === undefined) {
      throw new ErrorAplicacion(
        503,
        'CONFIGURACION_INCOMPLETA',
        'El servidor no tiene configurada su dirección pública, así que no se puede armar el enlace. Avisa a soporte.',
      );
    }
    return { url: `${base}/publico/comprobantes/${sello}`, expiraEn: expiraEn.toISOString() };
  }

  /** El número y la clave del PDF de un comprobante visible, o 409 `PDF_NO_DISPONIBLE` (criterio 159). */
  private async archivoDelPdf(comprobanteId: string): Promise<{ numero: string; clave: string }> {
    const filas = await this.conexion.query<{
      serie: string;
      numero: number;
      estado: EstadoComprobante;
      pdf_clave: string | null;
    }>('SELECT serie, numero, estado, pdf_clave FROM comprobante WHERE id = $1', {
      bind: [comprobanteId],
      type: QueryTypes.SELECT,
    });
    const fila = filas[0];
    if (fila === undefined) throw comprobanteNoEncontrado();
    if (fila.estado !== 'ACEPTADO' && fila.estado !== 'ANULADO') throw pdfNoDisponible();
    if (fila.pdf_clave === null) {
      throw pdfNoDisponible('El PDF se está preparando; inténtalo de nuevo en un minuto');
    }
    // Solo se sirve el archivo exacto de este comprobante (criterios 165 y 167): una clave distinta (de otra empresa, de otro
    // comprobante o con `..`, que un bucket resuelve a otra carpeta) es como no tener PDF, igual que en la ruta pública.
    if (!esClaveDelPdfDe(fila.pdf_clave, this.contexto.empresaActual(), comprobanteId)) {
      throw pdfNoDisponible();
    }
    return { numero: textoDelNumero(fila.serie, fila.numero), clave: fila.pdf_clave };
  }
}

function itemDelPanel(f: FilaDelPanel): PanelItem {
  return {
    id: f.id,
    tipo: f.tipo,
    numero: textoDelNumero(f.serie, f.numero),
    estado: f.estado,
    simulado: f.simulado,
    total: f.total,
    fechaEmision: f.fecha_emision,
    emitidoEn: f.emitido_en.toISOString(),
    cliente: f.cliente_nombre,
    sucursal: { id: f.sucursal_id, nombre: f.sucursal_nombre },
    alerta: f.alerta,
    envio: envioRespuestaDe(f),
    sunat:
      f.sunat_codigo === null && f.sunat_mensaje === null
        ? null
        : { codigo: f.sunat_codigo, mensaje: f.sunat_mensaje },
    afectaA: referencia(f.afecta_id, f.afecta_serie, f.afecta_numero),
    reemplazaA: referencia(f.reemplaza_id, f.reemplaza_serie, f.reemplaza_numero),
    reemplazadoPor: referencia(f.reemplazado_id, f.reemplazado_serie, f.reemplazado_numero),
  };
}
