import { autorizacionRespuestaSchema, type AutorizacionRespuesta } from '@restaurante/contratos';
import type { Accion } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  Hoja,
  IconoCandado,
  PuntosPin,
  Segmentos,
  TecladoNumerico,
  type EstadoPuntos,
} from '@restaurante/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ahoraDelServidor, api } from '../lib/api';
import { ErrorApi, mensajeDeError } from '../lib/errores';
import { relojDeCuenta } from '../lib/formato';
import { useSegundosHasta } from '../lib/tiempo';

/** Atajos de un toque para el motivo: lo más frecuente en el salón. Cada pantalla puede pasar los suyos. */
export const ATAJOS_DE_MOTIVO = [
  'Error al comandar',
  'El cliente lo pidió',
  'Producto agotado',
] as const;

/** Largo del PIN de supervisor (criterio 46). */
const LARGO_PIN = 6;
/** Cuánto se ve el error en los puntos antes de vaciarlos. */
const MS_DE_ERROR_EN_PUNTOS = 600;

/** Mensaje único de una clave rechazada: nunca dice si el PIN no existe, es de otro rol o está fuera de horario. */
const CLAVE_NO_VALIDA = {
  titulo: 'La clave no es válida',
  texto: 'Revisa el PIN del supervisor e inténtalo de nuevo.',
} as const;

export interface PropsVentanaClaveSupervisor {
  abierta: boolean;
  /** Acción de la matriz de permisos que se autoriza. */
  accion: Accion;
  /**
   * Qué se autoriza, con el dato que la hace reconocible, para que el supervisor lo lea antes de dar su
   * clave ("Anular ítem: Ceviche mixto x1 · S/ 38.00").
   */
  descripcion: string;
  /** Motivos de un toque; por defecto `ATAJOS_DE_MOTIVO`. */
  atajos?: readonly string[];
  /**
   * La API autorizó. `autorizacionId` va en `X-Autorizacion` al repetir la acción (`api.post(…,
   * { autorizacion: id })`); vale para esa sola acción y vence en `expiraEn` (2 minutos).
   */
  onAutorizada: (autorizacion: AutorizacionRespuesta) => void;
  /** Se cerró sin autorizar (botón "Cancelar", cortina, Escape). También se llama al cerrar tras autorizar: hay que tolerarlo. */
  onCancelar: () => void;
}

interface PropsContenido extends Omit<PropsVentanaClaveSupervisor, 'abierta'> {
  atajos: readonly string[];
}

/** Contenido de la ventana. Solo existe mientras está abierta: el PIN escrito no sobrevive al cierre. */
function Contenido({ accion, descripcion, atajos, onAutorizada, onCancelar }: PropsContenido) {
  const [motivo, setMotivo] = useState('');
  const motivoActual = useRef('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const pinActual = useRef('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<ErrorApi | null>(null);
  const [puntosEnError, setPuntosEnError] = useState(false);
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(null);
  const faltan = useSegundosHasta(bloqueadoHasta);
  const bloqueado = faltan > 0;
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const poner = useCallback((valor: string) => {
    pinActual.current = valor;
    setPin(valor);
  }, []);

  useEffect(() => {
    if (bloqueadoHasta !== null && faltan === 0) {
      setBloqueadoHasta(null);
      setFallo(null);
    }
  }, [bloqueadoHasta, faltan]);

  useEffect(() => {
    if (!puntosEnError) return;
    const temporizador = setTimeout(() => {
      setPuntosEnError(false);
      poner('');
    }, MS_DE_ERROR_EN_PUNTOS);
    return () => clearTimeout(temporizador);
  }, [puntosEnError, poner]);

  const ponerMotivo = useCallback((valor: string) => {
    motivoActual.current = valor;
    setMotivo(valor);
    setErrorMotivo(null);
  }, []);

  const enviar = useCallback(
    async (pinCompleto: string) => {
      const motivoLimpio = motivoActual.current.trim();
      if (motivoLimpio === '') {
        setErrorMotivo('Elige o escribe el motivo');
        return;
      }
      if (Array.from(motivoLimpio).length > 300) {
        setErrorMotivo('Usa 300 caracteres como máximo');
        return;
      }
      setEnviando(true);
      setFallo(null);
      try {
        const respuesta = await api.post(
          '/autorizaciones',
          { accion, motivo: motivoLimpio, pin: pinCompleto },
          { esquema: autorizacionRespuestaSchema, idempotente: true, reintentos: 2 },
        );
        poner('');
        onAutorizada(respuesta);
      } catch (error) {
        const e =
          error instanceof ErrorApi
            ? error
            : new ErrorApi({ estado: 0, codigo: 'SIN_CONEXION', mensaje: '' });
        if (!montado.current) return;
        setFallo(e);
        if (e.codigo === 'BLOQUEO_TEMPORAL') {
          setBloqueadoHasta(ahoraDelServidor() + (e.reintentarEnSegundos ?? 300) * 1000);
          poner('');
        } else if (e.codigo === 'CLAVE_INVALIDA') {
          setPuntosEnError(true);
        } else {
          if (e.codigo === 'DATOS_INVALIDOS')
            setErrorMotivo('Revisa el motivo e inténtalo de nuevo');
          poner('');
        }
      } finally {
        if (montado.current) setEnviando(false);
      }
    },
    [accion, onAutorizada, poner],
  );

  const ocupado = enviando || bloqueado;

  const alDigito = useCallback(
    (digito: string) => {
      if (ocupado) return;
      const base = puntosEnError ? '' : pinActual.current;
      if (base.length >= LARGO_PIN) return;
      const siguiente = base + digito;
      setPuntosEnError(false);
      setFallo((f) => (f?.codigo === 'CLAVE_INVALIDA' ? null : f));
      poner(siguiente);
      if (siguiente.length === LARGO_PIN) void enviar(siguiente);
    },
    [enviar, ocupado, poner, puntosEnError],
  );

  const alBorrar = useCallback(() => {
    if (ocupado || puntosEnError) return;
    poner(pinActual.current.slice(0, -1));
  }, [ocupado, poner, puntosEnError]);

  const estadoPuntos: EstadoPuntos = bloqueado ? 'apagado' : puntosEnError ? 'error' : 'normal';

  let mensaje: ReactNode = null;
  if (bloqueado) {
    mensaje = (
      <Aviso tipo="error" icono={IconoCandado} titulo="Clave bloqueada por unos minutos">
        Hubo demasiados intentos. Podrás volver a intentar cuando termine la cuenta.
        <span
          className="cuenta-regresiva"
          role="timer"
          aria-label={`Faltan ${relojDeCuenta(faltan)}`}
        >
          {relojDeCuenta(faltan)}
        </span>
      </Aviso>
    );
  } else if (fallo?.codigo === 'CLAVE_INVALIDA') {
    mensaje = (
      <Aviso tipo="error" titulo={CLAVE_NO_VALIDA.titulo}>
        {CLAVE_NO_VALIDA.texto}
      </Aviso>
    );
  } else if (fallo?.codigo === 'CLAVE_INNECESARIA') {
    mensaje = (
      <Aviso tipo="info" titulo="Esta acción no necesita clave">
        Cierra esta ventana y vuelve a intentarla.
      </Aviso>
    );
  } else if (fallo?.codigo === 'PROHIBIDO') {
    mensaje = (
      <Aviso tipo="error" titulo="No puedes hacer esta acción">
        Tu rol no la permite, ni siquiera con la clave de un supervisor.
      </Aviso>
    );
  } else if (fallo) {
    mensaje = (
      <Aviso tipo="error" titulo={fallo.sinConexion ? 'No hay conexión' : 'No pudimos autorizar'}>
        {mensajeDeError(fallo)}
      </Aviso>
    );
  }

  return (
    <div className="formulario clave">
      <div className="clave__accion">
        <span className="texto-ayuda">Se autoriza (queda registrado con tu nombre)</span>
        <b>{descripcion}</b>
      </div>

      <div className="formulario__grupo">
        <Segmentos
          etiqueta="Motivos frecuentes"
          opciones={atajos.map((a) => ({ valor: a, etiqueta: a }))}
          valor={atajos.includes(motivo) ? motivo : ''}
          onCambio={(valor) => {
            ponerMotivo(valor);
            // Con el PIN ya escrito, elegir el motivo completa el envío.
            if (pinActual.current.length === LARGO_PIN && !ocupado) void enviar(pinActual.current);
          }}
        />
        <CampoAreaTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => ponerMotivo(e.target.value)}
          error={errorMotivo ?? undefined}
          maxLength={300}
          rows={1}
        />
      </div>

      <div className="clave__pin">
        <span className="ui-campo__etiqueta" id="clave-pin-etiqueta">
          PIN del supervisor (6 dígitos)
        </span>
        <PuntosPin largo={LARGO_PIN} llenos={pin.length} estado={estadoPuntos} />
        <div className="clave__mensaje">{mensaje}</div>
        <TecladoNumerico compacto onDigito={alDigito} onBorrar={alBorrar} deshabilitado={ocupado} />
      </div>

      <Boton
        variante="principal"
        bloque
        cargando={enviando}
        textoCargando="Autorizando…"
        disabled={pin.length !== LARGO_PIN || bloqueado || puntosEnError}
        onClick={() => void enviar(pinActual.current)}
      >
        Autorizar
      </Boton>
      <Boton variante="texto" bloque onClick={onCancelar} disabled={enviando}>
        Cancelar
      </Boton>
    </div>
  );
}

/**
 * Ventana de clave de supervisor (criterio 98). Pide el motivo (con atajos de un toque) y el PIN de 6
 * dígitos del supervisor en el teclado propio, llama `POST /autorizaciones` y devuelve la autorización a
 * quien la abrió. Una clave rechazada dice siempre lo mismo, sea cual sea la causa (el servidor tampoco
 * la distingue); tras varios fallos muestra el bloqueo con su cuenta regresiva. No guarda el PIN: vive
 * solo en el estado de la ventana abierta y se vacía al cerrarla.
 */
export function VentanaClaveSupervisor({
  abierta,
  atajos = ATAJOS_DE_MOTIVO,
  onCancelar,
  ...resto
}: PropsVentanaClaveSupervisor) {
  return (
    <Hoja abierta={abierta} onCerrar={onCancelar} titulo="Clave de supervisor">
      <Contenido {...resto} atajos={atajos} onCancelar={onCancelar} />
    </Hoja>
  );
}
