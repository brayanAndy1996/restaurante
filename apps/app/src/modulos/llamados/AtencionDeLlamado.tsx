import type { LlamadoResumen } from '@restaurante/contratos';
import { MAXIMO_COMENSALES } from '@restaurante/dominio';
import { Aviso, Boton, ContadorGrande, Hoja, nombreAccesibleDeMesa } from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { rutaDeLlamado, rutaDeOrden } from '../salon/salon';
import { useSalon } from '../salon/useSalon';
import { atenderLlamado } from './llamados';

/**
 * Atender un llamado (005, criterios 41 a 45 y 71 a 73). Lo usan la lista y el detalle.
 *
 * - Con la mesa libre pide los comensales (por defecto, la capacidad de la mesa) en la hoja "Atender y abrir
 *   la mesa": quien atiende abre la mesa y queda como mozo responsable. Un "pedir la cuenta" no abre la mesa.
 * - Si dos personas tocan "Atender" a la vez, la segunda lee "Ana ya está atendiendo este llamado".
 * - El `id` de la orden que se abre se genera una vez por hoja y se conserva en los reintentos.
 * - Al atender: un pedido lleva a su detalle, para revisarlo con el cliente; "pedir la cuenta" lleva a la
 *   cuenta de la mesa con la pre-cuenta a la vista; "llamar al mozo" solo cierra el aviso.
 */

const MENSAJES = {
  NO_ENCONTRADO: 'Este llamado ya no existe o no es de tu sucursal. Actualiza la lista.',
  LLAMADO_VENCIDO:
    'Este llamado venció sin que nadie lo atendiera. El cliente tendrá que volver a enviarlo.',
  CONFLICTO: 'Esta mesa está desactivada. Pide al administrador que la active.',
  REFERENCIA_INVALIDA:
    'Para abrir una mesa hace falta una persona de la sucursal. Ábrela desde el salón y vuelve a atender.',
  MESA_LIBRE: 'La mesa está libre. Indica cuántos comensales hay para abrirla.',
  // Un `ordenId` ya usado u otro dato que la hoja no puede corregir: cerrarla y atender de nuevo genera uno nuevo.
  DATOS_INVALIDOS: 'No pudimos atenderlo con estos datos. Ciérralo y vuelve a tocar «Atender».',
} as const;

/** Lo que se dice cuando el llamado ya estaba cerrado, según el estado en que quedó. */
export function textoDeCerrado(estado: string | undefined): string {
  switch (estado) {
    case 'PASADO_A_CUENTA':
      return 'Este pedido ya se pasó a la cuenta.';
    case 'DESCARTADO':
      return 'Este llamado ya se descartó.';
    case 'VENCIDO':
      return 'Este llamado venció sin que nadie lo atendiera.';
    default:
      return 'Este llamado ya no se puede atender.';
  }
}

/** El texto de un fallo al atender, en palabras; `LLAMADO_TOMADO` nombra a quien ya lo atiende. */
export function textoDeFalloAlAtender(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.codigo === 'LLAMADO_TOMADO')
      return `${error.atendidoPor?.nombre ?? 'Otra persona'} ya está atendiendo este llamado.`;
    if (error.codigo === 'LLAMADO_CERRADO') return textoDeCerrado(error.estadoDelLlamado);
  }
  return mensajeDeError(error, MENSAJES);
}

type Llamado = Pick<LlamadoResumen, 'id' | 'tipo' | 'mesa' | 'ordenId'>;

export function useAtencion() {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const salon = useSalon(sesion.sucursal?.id ?? '');
  const [hoja, setHoja] = useState<{ llamado: Llamado; capacidad: number } | null>(null);
  const [resultado, setResultado] = useState<{
    tipo: 'ok' | 'alerta' | 'error';
    titulo: string;
    texto: string;
  } | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const mesas = useMemo(() => {
    const mapa = new Map<string, { capacidad: number; libre: boolean }>();
    for (const zona of salon.data?.salon.zonas ?? [])
      for (const mesa of zona.mesas)
        mapa.set(mesa.id, { capacidad: mesa.capacidad, libre: mesa.orden === null });
    return mapa;
  }, [salon.data]);

  const atencion = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: ({
      llamado,
      entrada,
    }: {
      llamado: Llamado;
      entrada: { ordenId?: string; comensales?: number };
    }) => envio.enviar((extra) => atenderLlamado(llamado.id, entrada, extra)),
    onSuccess: (respuesta, { llamado }) => {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
      if (respuesta.mesaAbierta)
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      if (!envio.sigueMontada()) return;
      setHoja(null);
      setFallo(null);
      const mesa = nombreAccesibleDeMesa(llamado.mesa.nombre);
      if (llamado.tipo === 'PEDIDO') {
        navegar(rutaDeLlamado(llamado.id), { state: { mesaAbierta: respuesta.mesaAbierta } });
      } else if (llamado.tipo === 'PEDIR_CUENTA' && respuesta.ordenId) {
        navegar(rutaDeOrden(respuesta.ordenId), { state: { pidieronLaCuenta: true } });
      } else {
        setResultado({
          tipo: 'ok',
          titulo: 'Llamado atendido',
          texto:
            llamado.tipo === 'PEDIR_CUENTA'
              ? `${mesa} pidió la cuenta, pero no tiene una cuenta abierta.`
              : respuesta.mesaAbierta
                ? `Atendiste a la ${mesa.toLowerCase()} y quedó abierta a tu nombre.`
                : `Atendiste a la ${mesa.toLowerCase()}.`,
        });
      }
    },
    onError: (error, { llamado }) => {
      if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      }
      if (!envio.sigueMontada()) return;
      if (error instanceof ErrorApi && error.codigo === 'MESA_LIBRE') {
        // La mesa se liberó mientras tanto: ahora hacen falta los comensales.
        setHoja({ llamado, capacidad: mesas.get(llamado.mesa.id)?.capacidad ?? 2 });
        return;
      }
      if (
        error instanceof ErrorApi &&
        (error.codigo === 'LLAMADO_TOMADO' ||
          error.codigo === 'LLAMADO_VENCIDO' ||
          error.codigo === 'LLAMADO_CERRADO' ||
          error.codigo === 'NO_ENCONTRADO')
      ) {
        // El llamado ya cambió: no hay nada que reintentar. Se dice quién lo tiene y la lista se actualiza.
        setHoja(null);
        setFallo(null);
        setResultado({
          tipo: 'alerta',
          titulo: 'No pudiste atenderlo',
          texto: textoDeFalloAlAtender(error),
        });
        return;
      }
      setFallo(textoDeFalloAlAtender(error));
    },
  });

  function enviar(llamado: Llamado, entrada: { ordenId?: string; comensales?: number }) {
    if (atencion.isPending) return;
    setResultado(null);
    setFallo(null);
    atencion.mutate({ llamado, entrada });
  }

  /** "Atender": con la mesa libre abre la hoja de comensales; si no, atiende de una vez. */
  function atender(llamado: Llamado) {
    const mesa = mesas.get(llamado.mesa.id);
    const libre = mesa ? mesa.libre : llamado.ordenId === null;
    if (llamado.tipo !== 'PEDIR_CUENTA' && libre) {
      setResultado(null);
      setFallo(null);
      setHoja({ llamado, capacidad: mesa?.capacidad ?? 2 });
      return;
    }
    enviar(llamado, {});
  }

  const aviso: ReactNode = resultado ? (
    <Aviso tipo={resultado.tipo} titulo={resultado.titulo}>
      {resultado.texto}
    </Aviso>
  ) : null;

  const hojaDeComensales = (
    <Hoja
      abierta={hoja !== null}
      onCerrar={() => {
        if (!atencion.isPending) {
          setHoja(null);
          setFallo(null);
        }
      }}
      titulo={
        hoja
          ? `Atender la ${nombreAccesibleDeMesa(hoja.llamado.mesa.nombre).toLowerCase()}`
          : 'Atender'
      }
    >
      {hoja ? (
        <FormularioDeAtencion
          key={hoja.llamado.id}
          llamado={hoja.llamado}
          capacidad={hoja.capacidad}
          cargando={atencion.isPending}
          pendiente={envio.pendiente}
          fallo={fallo}
          onAtender={(entrada) => enviar(hoja.llamado, entrada)}
          onCerrar={() => {
            setHoja(null);
            setFallo(null);
          }}
        />
      ) : null}
    </Hoja>
  );

  return {
    atender,
    /** El llamado que se está atendiendo ahora mismo (para apagar su botón). */
    atendiendoId: atencion.isPending ? (atencion.variables?.llamado.id ?? null) : null,
    /** Lo que pasó al atender, para mostrarlo arriba de la pantalla. */
    aviso,
    /** Un fallo que no cierra la hoja (sin hoja abierta se muestra en `aviso`). */
    falloSinHoja: hoja === null ? fallo : null,
    hoja: hojaDeComensales,
  };
}

function FormularioDeAtencion({
  llamado,
  capacidad,
  cargando,
  pendiente,
  fallo,
  onAtender,
  onCerrar,
}: {
  llamado: Llamado;
  capacidad: number;
  cargando: boolean;
  pendiente: boolean;
  fallo: string | null;
  onAtender: (entrada: { ordenId: string; comensales: number }) => void;
  onCerrar: () => void;
}) {
  // El `id` de la orden lo genera esta hoja y se conserva en los reintentos: atender dos veces con el mismo
  // `id` no abre dos órdenes (criterio 42).
  const [ordenId] = useState(() => nuevaClaveDeIdempotencia());
  const [comensales, setComensales] = useState(() =>
    Math.min(Math.max(capacidad, 1), MAXIMO_COMENSALES),
  );
  return (
    <form
      className="formulario"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!cargando) onAtender({ ordenId, comensales });
      }}
      noValidate
    >
      <p className="llamado-hoja__texto">
        {nombreAccesibleDeMesa(llamado.mesa.nombre)} está libre. Al atender la abres y quedas como
        su mozo responsable.
      </p>
      <section className="salon-apertura__bloque" aria-label="Comensales">
        <h3 className="ui-campo__etiqueta">Comensales</h3>
        <ContadorGrande
          nombre="comensales"
          unidad={comensales === 1 ? 'comensal' : 'comensales'}
          valor={comensales}
          minimo={1}
          maximo={MAXIMO_COMENSALES}
          onCambio={setComensales}
        />
        <p className="ui-campo__ayuda">
          La mesa es para {capacidad} {capacidad === 1 ? 'persona' : 'personas'}.
        </p>
      </section>
      <AvisoPendiente pendiente={pendiente} />
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos atenderlo">
          {fallo}
        </Aviso>
      ) : null}
      <Boton
        type="submit"
        variante="principal"
        bloque
        cargando={cargando}
        textoCargando="Atendiendo…"
      >
        Atender y abrir la mesa
      </Boton>
      <Boton bloque onClick={onCerrar} disabled={cargando}>
        Cancelar
      </Boton>
    </form>
  );
}
