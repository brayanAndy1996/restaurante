import type { AutorizacionRespuesta, ItemRespuesta, OrdenRespuesta } from '@restaurante/contratos';
import type { Accion } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  DialogoConfirmacion,
  Hoja,
  OpcionesConAyuda,
  SelectorDeCantidad,
  Segmentos,
} from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ATAJOS_DE_MOTIVO } from '../../componentes/VentanaClaveSupervisor';
import { useClaveDeSupervisor } from '../../componentes/useClaveDeSupervisor';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { ahoraDelServidor, nuevaClaveDeIdempotencia } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeError } from '../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import {
  OPCIONES_DE_DESTINO,
  anularItem,
  anularOrden,
  importeDeAnular,
  liberarMesa,
  resumenDeAnularItem,
  resumenDeAnularOrden,
  sePuedeAnularItem,
  unidadesVigentes,
  type DestinoDeStock,
} from './anulaciones';
import { estaAbierta, textoDeItems, tituloDeMesas } from './ordenes';
import './anular.css';

/** Qué se anula: un ítem de la cuenta o la cuenta entera. */
export type ObjetivoDeAnulacion = { tipo: 'item'; itemId: string } | { tipo: 'orden' };

/** Largo máximo del motivo (`motivoSchema`). */
const LARGO_MOTIVO = 300;
/** Una autorización que vence en menos de esto se pide de nuevo antes de usarla. */
const MARGEN_DE_AUTORIZACION_MS = 5_000;

const MENSAJES = {
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta. Actualizamos la pantalla.',
  ITEM_NO_ANULABLE: 'Este ítem ya estaba anulado. Actualizamos la pantalla.',
  NO_ENCONTRADO: 'Esto ya no está en la cuenta. Actualizamos la pantalla.',
  PROHIBIDO: 'Tu rol no puede hacer esto.',
  CLAVE_IDEMPOTENCIA_REUTILIZADA:
    'Esta anulación ya se había enviado con otros datos. Cierra esta ventana y vuelve a abrirla.',
} as const;

/** Errores que la pantalla debe volver a leer de la API (la cuenta cambió mientras se anulaba). */
const CODIGOS_DE_CUENTA_CAMBIADA = new Set([
  'ORDEN_NO_ABIERTA',
  'ITEM_NO_ANULABLE',
  'NO_ENCONTRADO',
  'DATOS_INVALIDOS',
]);

/** Lo que se repite sin cambiar entre un intento y su reintento: el mismo `id` y la misma clave. */
interface Intento {
  huella: string;
  anulacionId: string;
  clave: string;
  autorizacionId: string | null;
}

interface PropsAnular {
  objetivo: ObjetivoDeAnulacion;
  /** La cuenta tal como está ahora en pantalla. */
  orden: OrdenRespuesta;
  onCerrar: () => void;
  /** Se anuló: el texto que la cuenta le dice a la persona. */
  onHecho: (texto: string) => void;
}

/**
 * Hoja "Anular ítem" y "Anular la orden" (criterio 93 de 004): la cantidad (por defecto toda, decisión 6), el
 * motivo con atajos y "¿El stock vuelve o es merma?" sin valor por defecto. Con `clave` sigue la ventana de
 * clave de supervisor de 002 con el mismo motivo; con `permitido`, una confirmación. Un corte de red repite la
 * misma `Idempotency-Key` y la misma autorización (`enviarSinPerder`); si la autorización venció, pide otra y
 * conserva lo elegido.
 */
export function AnularHoja(props: PropsAnular) {
  const { objetivo, onCerrar } = props;
  return (
    <Hoja
      abierta
      onCerrar={onCerrar}
      titulo={objetivo.tipo === 'item' ? 'Anular ítem' : 'Anular la orden'}
      className="hoja-anular"
    >
      <Formulario {...props} />
    </Hoja>
  );
}

function Formulario({ objetivo, orden, onHecho }: PropsAnular) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const { pedir, ventana } = useClaveDeSupervisor();
  const esItem = objetivo.tipo === 'item';
  const accion: Accion = esItem ? 'ANULAR_ITEM_ENVIADO' : 'ANULAR_ORDEN';
  const permiso = usePermiso(accion);

  const item: ItemRespuesta | null = esItem
    ? (orden.items.find((i) => i.id === objetivo.itemId) ?? null)
    : null;
  const vigente = item?.cantidadVigente ?? 0;
  // Todo lo que se pueda anular se ofrece como en la cuenta de ahora: si otra persona anuló antes, baja solo.
  const anulable = esItem ? item !== null && sePuedeAnularItem(item) : estaAbierta(orden);

  const [cantidadElegida, setCantidadElegida] = useState<number | null>(null);
  const cantidad = Math.min(Math.max(cantidadElegida ?? vigente, 1), Math.max(vigente, 1));
  const [motivo, setMotivo] = useState('');
  const [destino, setDestino] = useState<DestinoDeStock | ''>('');
  const [errores, setErrores] = useState<{ motivo?: string; destino?: string }>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const autorizacion = useRef<AutorizacionRespuesta | null>(null);
  const intento = useRef<Intento | null>(null);

  const motivoLimpio = motivo.trim();
  const resumen = item ? resumenDeAnularItem(item, cantidad) : resumenDeAnularOrden(orden);
  const descripcion = `${esItem ? 'Anular ítem' : 'Anular la orden'}: ${resumen}`;

  function revisar(): boolean {
    const nuevos: { motivo?: string; destino?: string } = {};
    if (motivoLimpio === '') nuevos.motivo = 'Elige o escribe el motivo';
    else if (Array.from(motivoLimpio).length > LARGO_MOTIVO)
      nuevos.motivo = `Usa ${LARGO_MOTIVO} caracteres como máximo`;
    if (destino === '') nuevos.destino = 'Elige qué pasa con el stock';
    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  }

  function alAnular() {
    if (enviando) return;
    setFallo(null);
    if (!revisar()) return;
    if (permiso === 'clave') void ejecutar();
    else setConfirmando(true);
  }

  /** La autorización que se tiene sirve si no está por vencer. */
  const autorizacionVigente = () => {
    const a = autorizacion.current;
    return a !== null && Date.parse(a.expiraEn) - ahoraDelServidor() > MARGEN_DE_AUTORIZACION_MS;
  };

  async function ejecutar() {
    if (destino === '') return;
    setEnviando(true);
    setFallo(null);
    try {
      // Una segunda vuelta solo si la API dice que la autorización ya no vale.
      for (let vuelta = 0; vuelta < 2; vuelta++) {
        let autorizacionId: string | null = null;
        if (permiso === 'clave') {
          if (!autorizacionVigente()) {
            if (autorizacion.current)
              setNota(
                'La autorización venció. Pide la clave del supervisor otra vez; lo que elegiste sigue aquí.',
              );
            autorizacion.current = null;
            const nueva = await pedir({ accion, descripcion, motivo: motivoLimpio });
            if (!nueva) return;
            autorizacion.current = nueva;
          }
          autorizacionId = autorizacion.current?.autorizacionId ?? null;
        }

        // Mientras nada cambie, un nuevo toque repite el mismo `id` y la misma clave de idempotencia.
        const huella = [objetivo.tipo, cantidad, motivoLimpio, destino].join('|');
        const previo = intento.current;
        const mismaAccion = previo?.huella === huella;
        const mismaAutorizacion = mismaAccion && previo?.autorizacionId === autorizacionId;
        const actual: Intento = {
          huella,
          anulacionId: mismaAccion && previo ? previo.anulacionId : nuevaClaveDeIdempotencia(),
          clave: mismaAutorizacion && previo ? previo.clave : nuevaClaveDeIdempotencia(),
          autorizacionId,
        };
        intento.current = actual;
        const extraDeAutorizacion = autorizacionId ? { autorizacion: autorizacionId } : {};

        try {
          if (item) {
            await envio.enviar(
              (extra) =>
                anularItem(
                  orden.id,
                  item.id,
                  { id: actual.anulacionId, cantidad, motivo: motivoLimpio, destinoStock: destino },
                  { ...extra, ...extraDeAutorizacion },
                ),
              undefined,
              undefined,
              actual.clave,
            );
          } else {
            await envio.enviar(
              (extra) =>
                anularOrden(
                  orden.id,
                  { motivo: motivoLimpio, destinoStock: destino },
                  { ...extra, ...extraDeAutorizacion },
                ),
              undefined,
              undefined,
              actual.clave,
            );
          }
        } catch (error) {
          const autorizacionPerdida =
            error instanceof ErrorApi &&
            permiso === 'clave' &&
            (error.codigo === 'AUTORIZACION_INVALIDA' || error.codigo === 'CLAVE_REQUERIDA');
          if (autorizacionPerdida && vuelta === 0) {
            // Venció (o ya se usó): se pide otra y se vuelve a enviar con otra clave de idempotencia.
            autorizacion.current = null;
            setNota(
              'La autorización venció. Pide la clave del supervisor otra vez; lo que elegiste sigue aquí.',
            );
            continue;
          }
          throw error;
        }

        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(orden.id) });
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
        onHecho(textoDeHecho(orden, item, cantidad));
        return;
      }
    } catch (error) {
      if (error instanceof ErrorApi && CODIGOS_DE_CUENTA_CAMBIADA.has(error.codigo)) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(orden.id) });
      }
      if (!envio.sigueMontada()) return;
      if (error instanceof ErrorApi && erroresPorCampo(error).cantidad !== undefined) {
        setFallo(
          'Ya no quedan tantas unidades por anular. Revisa la cantidad y vuelve a intentarlo.',
        );
      } else if (
        error instanceof ErrorApi &&
        (error.codigo === 'AUTORIZACION_INVALIDA' || error.codigo === 'CLAVE_REQUERIDA')
      ) {
        setFallo('La clave del supervisor no valió. Vuelve a pedirla.');
      } else {
        setFallo(mensajeDeError(error, MENSAJES));
      }
    } finally {
      if (envio.sigueMontada()) {
        setEnviando(false);
        setConfirmando(false);
      }
    }
  }

  const etiquetaPrincipal =
    permiso === 'clave' ? 'Pedir clave de supervisor' : esItem ? 'Anular ítem' : 'Anular la orden';

  return (
    <>
      <div className="formulario anular">
        {!anulable ? (
          <Aviso
            tipo="alerta"
            titulo={esItem ? 'Este ítem ya no se puede anular' : 'Cuenta cerrada'}
          >
            {esItem
              ? 'Ya está anulado o la cuenta cambió. Cierra esta ventana y mira la cuenta.'
              : 'Esta cuenta ya no está abierta. Cierra esta ventana y mira la cuenta.'}
          </Aviso>
        ) : null}

        <div className="anular__que">
          {item ? (
            <>
              <b>{item.nombre}</b>
              <span className="texto-ayuda">
                {vigente === 1 ? '1 enviado' : `${vigente} enviados`} ·{' '}
                {importeDeAnular(item, vigente)}
              </span>
            </>
          ) : (
            <>
              <b>{tituloDeMesas(orden.mesas)}</b>
              <span className="texto-ayuda">
                {textoDeItems(unidadesVigentes(orden))} · la mesa queda libre
              </span>
            </>
          )}
        </div>

        {item && vigente > 1 ? (
          <div className="anular__cantidad">
            <span className="ui-campo__etiqueta">Cuántos anulas</span>
            <SelectorDeCantidad
              nombre={item.nombre}
              valor={cantidad}
              maximo={vigente}
              onCambio={setCantidadElegida}
            />
          </div>
        ) : null}

        <div className="formulario__grupo">
          <Segmentos
            etiqueta="Motivos frecuentes"
            opciones={ATAJOS_DE_MOTIVO.map((a) => ({ valor: a, etiqueta: a }))}
            valor={ATAJOS_DE_MOTIVO.find((a) => a === motivo) ?? ''}
            onCambio={(valor) => {
              setMotivo(valor);
              setErrores((e) => ({ ...e, motivo: undefined }));
            }}
          />
          <CampoAreaTexto
            etiqueta="Motivo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErrores((previos) => ({ ...previos, motivo: undefined }));
            }}
            error={errores.motivo}
            maxLength={LARGO_MOTIVO}
            rows={1}
          />
        </div>

        <OpcionesConAyuda
          etiqueta="¿El stock vuelve o es merma?"
          opciones={OPCIONES_DE_DESTINO}
          valor={destino}
          onCambio={(valor) => {
            setDestino(valor);
            setErrores((e) => ({ ...e, destino: undefined }));
          }}
          error={errores.destino}
        />

        {nota ? (
          <Aviso tipo="info" titulo="Falta una clave nueva">
            {nota}
          </Aviso>
        ) : null}
        <div className="anular__pie">
          <AvisoPendiente pendiente={envio.pendiente} />
          {fallo ? (
            <Aviso tipo="error" titulo="No pudimos anular">
              {fallo}
            </Aviso>
          ) : null}
          <Boton
            variante="principal"
            bloque
            cargando={enviando && !confirmando}
            textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Anulando…'}
            disabled={!anulable}
            onClick={alAnular}
          >
            {etiquetaPrincipal}
          </Boton>
        </div>
      </div>

      <DialogoConfirmacion
        abierta={confirmando}
        titulo={esItem ? `¿Anular ${cantidad} × ${item?.nombre ?? ''}?` : '¿Anular la orden?'}
        etiquetaConfirmar={esItem ? 'Sí, anular ítem' : 'Sí, anular la orden'}
        peligro
        cargando={enviando}
        textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Anulando…'}
        onConfirmar={() => void ejecutar()}
        onCancelar={() => {
          if (!enviando) setConfirmando(false);
        }}
      >
        <p>
          {item
            ? `Se quitan ${importeDeAnular(item, cantidad)} de la cuenta y cocina recibe el aviso.`
            : `Se anulan ${textoDeItems(unidadesVigentes(orden))} y la mesa queda libre. Cocina recibe el aviso.`}{' '}
          {destino === 'VUELVE'
            ? 'El stock vuelve.'
            : destino === 'MERMA'
              ? 'Queda como merma.'
              : ''}
        </p>
      </DialogoConfirmacion>
      {ventana}
    </>
  );
}

/** Lo que la cuenta dice al terminar. */
function textoDeHecho(orden: OrdenRespuesta, item: ItemRespuesta | null, cantidad: number): string {
  const precuenta =
    orden.estado === 'EN_PRECUENTA'
      ? ' La pre-cuenta ya no vale: pide otra al cerrar la cuenta.'
      : '';
  if (!item) return `Anulaste la orden. La mesa quedó libre.${precuenta}`;
  return `Anulaste ${cantidad} × ${item.nombre}.${precuenta}`;
}

interface PropsLiberar {
  orden: OrdenRespuesta;
  onCerrar: () => void;
  onHecho: () => void;
  /** La API dijo que la cuenta ya tuvo consumo (409 `ORDEN_CON_CONSUMO`). */
  onConConsumo: () => void;
}

/**
 * "Liberar la mesa" (decisión 7, criterio 44): una mesa abierta por error y sin nada vigente se libera sin
 * clave, con una confirmación. Si la cuenta ya tuvo consumo, la API dice 409 y se ofrece "Anular la orden".
 */
export function LiberarMesaHoja({ orden, onCerrar, onHecho, onConConsumo }: PropsLiberar) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  // Un nuevo toque tras un fallo repite la misma clave de idempotencia.
  const clave = useRef(nuevaClaveDeIdempotencia());

  async function liberar() {
    if (enviando) return;
    setEnviando(true);
    setFallo(null);
    try {
      await envio.enviar(
        (extra) => liberarMesa(orden.id, extra),
        undefined,
        undefined,
        clave.current,
      );
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(orden.id) });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      onHecho();
    } catch (error) {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(orden.id) });
      if (error instanceof ErrorApi && error.codigo === 'ORDEN_CON_CONSUMO') {
        onConConsumo();
        return;
      }
      if (!envio.sigueMontada()) return;
      setFallo(
        mensajeDeError(error, {
          ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta. Actualizamos la pantalla.',
        }),
      );
    } finally {
      if (envio.sigueMontada()) setEnviando(false);
    }
  }

  return (
    <DialogoConfirmacion
      abierta
      titulo={`¿Liberar ${tituloDeMesas(orden.mesas)}?`}
      etiquetaConfirmar="Liberar la mesa"
      cargando={enviando}
      textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Liberando…'}
      error={
        <>
          <AvisoPendiente pendiente={envio.pendiente} />
          {fallo ? (
            <Aviso tipo="error" titulo="No pudimos liberar la mesa">
              {fallo}
            </Aviso>
          ) : null}
        </>
      }
      onConfirmar={() => void liberar()}
      onCancelar={() => {
        if (!enviando) onCerrar();
      }}
    >
      <p>No se envió nada a cocina, así que no hay nada que cobrar. La mesa queda libre.</p>
    </DialogoConfirmacion>
  );
}
