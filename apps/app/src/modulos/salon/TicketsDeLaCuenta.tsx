import type { OrdenRespuesta } from '@restaurante/contratos';
import { Aviso, ErrorDeCarga, EsqueletoDeLista, Plegable } from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { mensajeDeError } from '../../lib/errores';
import { ListaDeTrabajos } from '../impresion/ListaDeTrabajos';
import {
  claveTrabajos,
  listarTrabajos,
  trabajosDeLaCuenta,
  useReimpresion,
} from '../impresion/trabajos';

/** Cada cuánto se vuelve a pedir la lista mientras está abierta. */
const PERIODO_DE_LA_LISTA_MS = 20_000;

/**
 * "Reimprimir" en la cuenta de la mesa (criterios 128 y 138): los tickets de esta cuenta (comandas, adiciones,
 * marchas, anulaciones y pre-cuentas) con un botón para sacar otra copia marcada "REIMPRESIÓN". La lista se
 * pide al abrir la sección: quien no la usa no gasta datos.
 */
export function TicketsDeLaCuenta({ orden }: { orden: OrdenRespuesta }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Plegable
      titulo="Tickets impresos"
      resumen="Si un ticket no salió, saca otra copia"
      abierto={abierto}
      onCambio={setAbierto}
    >
      {abierto ? <Tickets orden={orden} /> : null}
    </Plegable>
  );
}

function Tickets({ orden }: { orden: OrdenRespuesta }) {
  const reimpresion = useReimpresion();
  const consulta = useQuery({
    queryKey: claveTrabajos(orden.sucursalId),
    queryFn: ({ signal }) => listarTrabajos(undefined, signal),
    refetchInterval: PERIODO_DE_LA_LISTA_MS,
    select: (trabajos) => trabajosDeLaCuenta(trabajos, orden),
  });
  const trabajos = consulta.data;

  return (
    <div className="cuenta__tickets">
      <AvisoPendiente pendiente={reimpresion.pendiente} />
      {reimpresion.hecho ? (
        <Aviso tipo="ok" titulo="Reimpresión en cola">
          Sale en cuanto el puente la reciba.
        </Aviso>
      ) : null}
      {reimpresion.fallo ? (
        <Aviso tipo="error" titulo="No pudimos reimprimir">
          {reimpresion.fallo.mensaje}
        </Aviso>
      ) : null}
      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando los tickets" conInicial={false} filas={2} />
      ) : consulta.isError && !trabajos ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los tickets"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : trabajos && trabajos.length === 0 ? (
        <p className="texto-ayuda">
          Esta cuenta no tiene tickets impresos. Lo que sale por la pantalla de cocina no se
          imprime.
        </p>
      ) : trabajos ? (
        <ListaDeTrabajos
          etiqueta="Tickets de la cuenta"
          trabajos={trabajos}
          conMesa={false}
          onReimprimir={(id) => void reimpresion.reimprimir(id)}
          enCurso={reimpresion.enCurso}
          pendiente={reimpresion.pendiente}
        />
      ) : null}
    </div>
  );
}
