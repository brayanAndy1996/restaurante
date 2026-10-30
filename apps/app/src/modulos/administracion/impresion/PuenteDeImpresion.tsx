import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  ErrorDeCarga,
  Esqueleto,
  EtiquetaDeEstado,
  IconoCelular,
  IconoOk,
  IconoOlvidar,
  IconoSinRed,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { MUTACION_SIN_PAUSA, type ExtraDeEscritura } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import {
  MENSAJES_DEL_PUENTE,
  claveEstadoImpresion,
  clavePuentes,
  detalleDelPuente,
  leerEstadoDeImpresion,
  listarPuentes,
  revocarPuente,
  situacionDelPuente,
} from './puente';
import { VincularPuente } from './VincularPuente';

/** Enviar una escritura sin perderla por un corte (el `enviar` de `useEnvioPendiente`). */
type Enviar = <T>(ejecutar: (extra: ExtraDeEscritura) => Promise<T>) => Promise<T>;

/** Mientras se muestra el código, cada cuánto se mira si el puente ya se vinculó. */
const PERIODO_DE_VINCULACION_MS = 3_000;
/** Cada cuánto se vuelve a escribir "hace 2 min". */
const PERIODO_DEL_RELOJ_MS = 15_000;

interface Props {
  sucursalId: string;
  enviar: Enviar;
}

/**
 * Ajustes › Impresión › Puente de impresión (criterio 137): el estado del puente con su última señal,
 * "Vincular puente" (QR, texto para copiar y cuenta regresiva) y "Revocar" con confirmación.
 *
 * El estado sale de `GET /impresion/estado` con la hora de la API (no la del equipo). Mientras el código
 * está a la vista se mira cada 3 segundos si apareció otro puente activo: entonces se cierra y dice
 * "Puente vinculado".
 */
export function PuenteDeImpresion({ sucursalId, enviar }: Props) {
  const clientes = useQueryClient();
  const [vinculando, setVinculando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [vinculado, setVinculado] = useState<string | null>(null);
  const [revocado, setRevocado] = useState<string | null>(null);
  const [falloRevocar, setFalloRevocar] = useState<string | null>(null);
  // El puente que había al abrir el código: otro distinto es el que se acaba de vincular.
  const puenteAlAbrir = useRef<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [, repintar] = useState(0);

  const consultaEstado = useQuery({
    queryKey: claveEstadoImpresion(sucursalId),
    queryFn: ({ signal }) => leerEstadoDeImpresion(signal),
    // Sin código a la vista, el aviso de todas las pantallas ya lo vuelve a pedir cada 30 s y con el evento.
    refetchInterval: vinculando ? PERIODO_DE_VINCULACION_MS : false,
  });
  const estado = consultaEstado.data;
  const puenteId = estado?.puente?.id ?? null;

  // El detalle (modelo y versión) es un extra: si no llega, el estado se ve igual.
  const consultaPuentes = useQuery({
    queryKey: [...clavePuentes(sucursalId), puenteId],
    queryFn: ({ signal }) => listarPuentes(sucursalId, signal),
    enabled: puenteId !== null,
  });
  const detalle = detalleDelPuente(consultaPuentes.data?.find((p) => p.id === puenteId));

  // "hace 2 min" avanza sola entre una consulta y la siguiente.
  useEffect(() => {
    const reloj = setInterval(() => repintar((n) => n + 1), PERIODO_DEL_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);

  // Se vinculó otro puente mientras el código estaba a la vista.
  useEffect(() => {
    if (!vinculando || !estado?.puente || estado.puente.id === puenteAlAbrir.current) return;
    setVinculando(false);
    setVinculado(estado.puente.nombre);
    requestAnimationFrame(() => titulo.current?.focus());
    void clientes.invalidateQueries({ queryKey: clavePuentes(sucursalId) });
  }, [vinculando, estado, clientes, sucursalId]);

  const revocar = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (id: string) => enviar((extra) => revocarPuente(sucursalId, id, extra)),
  });

  function abrirVinculacion() {
    puenteAlAbrir.current = puenteId;
    setVinculado(null);
    setRevocado(null);
    setVinculando(true);
  }

  async function confirmarRevocar() {
    if (!estado?.puente) return;
    const { id, nombre } = estado.puente;
    setFalloRevocar(null);
    try {
      await revocar.mutateAsync(id);
      setConfirmando(false);
      setRevocado(nombre);
      setVinculado(null);
      // El estado ya no tiene puente: se vuelve a pedir y el que se ve se vacía al instante.
      clientes.setQueryData(claveEstadoImpresion(sucursalId), (anterior: typeof estado) =>
        anterior ? { ...anterior, puente: null } : anterior,
      );
      void clientes.invalidateQueries({ queryKey: claveEstadoImpresion(sucursalId) });
      void clientes.invalidateQueries({ queryKey: clavePuentes(sucursalId) });
      requestAnimationFrame(() => titulo.current?.focus());
    } catch (error) {
      setFalloRevocar(mensajeDeError(error, MENSAJES_DEL_PUENTE));
    }
  }

  const situacion = estado
    ? situacionDelPuente(estado, Date.now() - consultaEstado.dataUpdatedAt)
    : null;

  return (
    <section className="impresion__bloque" aria-labelledby="impresion-puente">
      <div className="impresion__cabecera">
        <h3 className="formulario__titulo" id="impresion-puente" ref={titulo} tabIndex={-1}>
          Puente de impresión
        </h3>
        <p className="texto-ayuda">
          El puente es la app de un celular Android del local que recibe los tickets y los manda a
          las impresoras de la red. Hay uno por sucursal.
        </p>
      </div>

      {vinculado ? (
        <Aviso tipo="ok" titulo="Puente vinculado">
          {`${vinculado} ya puede recibir los tickets de esta sucursal.`}
        </Aviso>
      ) : null}
      {revocado ? (
        <Aviso tipo="ok" titulo="Puente revocado">
          {`${revocado} dejó de recibir tickets. Los que estaban en cola esperan hasta que vincules otro puente.`}
        </Aviso>
      ) : null}

      {consultaEstado.isPending ? (
        <div className="puente__estado" role="status" aria-label="Cargando el puente">
          <Esqueleto alto="1.5rem" ancho="40%" />
          <Esqueleto alto="1.25rem" ancho="70%" />
        </div>
      ) : consultaEstado.isError && !estado ? (
        <ErrorDeCarga
          titulo="No pudimos cargar el puente"
          onReintentar={() => void consultaEstado.refetch()}
          reintentando={consultaEstado.isFetching}
        >
          {mensajeDeError(consultaEstado.error)}
        </ErrorDeCarga>
      ) : situacion ? (
        <div className="puente__estado">
          {situacion.tipo === 'ninguno' ? (
            <>
              <EtiquetaDeEstado tono="neutro">Sin puente</EtiquetaDeEstado>
              <p>
                Aún no hay un puente vinculado. Sin él, los tickets quedan en la cola y no se
                imprimen.
              </p>
            </>
          ) : (
            <>
              <div className="puente__nombre">
                <b>{situacion.nombre}</b>
                {situacion.tipo === 'conectado' ? (
                  <EtiquetaDeEstado tono="ok" icono={IconoOk}>
                    Conectado
                  </EtiquetaDeEstado>
                ) : (
                  <EtiquetaDeEstado tono="alerta" icono={IconoSinRed}>
                    Sin señal
                  </EtiquetaDeEstado>
                )}
              </div>
              {detalle ? <p className="texto-ayuda">{detalle}</p> : null}
              <p>
                {situacion.senal
                  ? `Última señal ${situacion.senal}.`
                  : 'Todavía no mandó ninguna señal.'}
                {situacion.tipo === 'sin-senal'
                  ? ' Abre la app puente en el celular y revisa que esté en el wifi del local. Los tickets esperan en la cola.'
                  : ''}
              </p>
            </>
          )}
        </div>
      ) : null}

      {vinculando ? (
        <VincularPuente
          sucursalId={sucursalId}
          reemplaza={estado?.puente?.nombre ?? null}
          onCerrar={() => {
            setVinculando(false);
            requestAnimationFrame(() => titulo.current?.focus());
          }}
        />
      ) : (
        <Boton icono={IconoCelular} bloque onClick={abrirVinculacion}>
          Vincular puente
        </Boton>
      )}

      {estado?.puente && !vinculando ? (
        <div className="ui-acciones__separada">
          <Boton
            variante="peligro"
            bloque
            icono={IconoOlvidar}
            onClick={() => {
              setFalloRevocar(null);
              setConfirmando(true);
            }}
          >
            Revocar
          </Boton>
        </div>
      ) : null}

      <DialogoConfirmacion
        abierta={confirmando}
        titulo="Revocar el puente"
        etiquetaConfirmar="Revocar"
        peligro
        cargando={revocar.isPending}
        textoCargando="Revocando…"
        error={
          falloRevocar ? (
            <Aviso tipo="error" titulo="No pudimos revocar el puente">
              {falloRevocar}
            </Aviso>
          ) : null
        }
        onConfirmar={() => void confirmarRevocar()}
        onCancelar={() => setConfirmando(false)}
      >
        {`${estado?.puente?.nombre ?? 'El puente'} dejará de recibir tickets y se cerrará su conexión. Los tickets que estén en cola esperarán hasta que vincules otro puente.`}
      </DialogoConfirmacion>
    </section>
  );
}
