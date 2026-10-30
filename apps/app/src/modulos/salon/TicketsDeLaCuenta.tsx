import type { OrdenRespuesta } from '@restaurante/contratos';
import { Aviso, ErrorDeCarga, EsqueletoDeLista, Plegable } from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { tituloDeEnvio } from './ordenes';
import { mensajeDeError } from '../../lib/errores';
import type { TrabajoResumen } from '@restaurante/contratos';
import { ListaDeTrabajos } from '../impresion/ListaDeTrabajos';
import {
  claveTrabajosDeOrden,
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
    queryKey: claveTrabajosDeOrden(orden.sucursalId, orden.id),
    // La API filtra por cuenta: no se baja la lista de todo el día para quedarse con unos pocos tickets.
    queryFn: ({ signal }) => listarTrabajos({ ordenId: orden.id }, signal),
    refetchInterval: PERIODO_DE_LA_LISTA_MS,
    select: (trabajos) => trabajosDeLaCuenta(trabajos, orden.id),
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
        gruposDeTickets(trabajos, orden).map((grupo) => (
          <section
            key={grupo.clave}
            className="cuenta__tickets-grupo"
            aria-label={`Tickets: ${grupo.titulo}`}
          >
            <h4 className="cuenta__tickets-titulo">{grupo.titulo}</h4>
            <ListaDeTrabajos
              etiqueta={`Tickets de ${grupo.titulo}`}
              trabajos={grupo.trabajos}
              conMesa={false}
              onReimprimir={(id) => void reimpresion.reimprimir(id)}
              enCurso={reimpresion.enCurso}
              pendiente={reimpresion.pendiente}
            />
          </section>
        ))
      ) : null}
    </div>
  );
}

interface GrupoDeTickets {
  clave: string;
  titulo: string;
  trabajos: TrabajoResumen[];
}

/**
 * Los tickets de la cuenta agrupados por envío, con el mismo título que lleva el envío en la cuenta
 * ("Comanda", "Adición 2"), y al final los que no son de un envío (marchas, anulaciones y pre-cuentas).
 */
function gruposDeTickets(
  trabajos: readonly TrabajoResumen[],
  orden: OrdenRespuesta,
): GrupoDeTickets[] {
  const porEnvio = new Map<number, TrabajoResumen[]>();
  const otros: TrabajoResumen[] = [];
  for (const t of trabajos) {
    if (t.envioNumero === null) {
      otros.push(t);
    } else {
      porEnvio.set(t.envioNumero, [...(porEnvio.get(t.envioNumero) ?? []), t]);
    }
  }
  const grupos: GrupoDeTickets[] = [...porEnvio.entries()]
    .sort(([a], [b]) => a - b)
    .map(([numero, lista]) => ({
      clave: `envio-${numero}`,
      titulo: tituloDeEnvio(
        numero,
        orden.items.some((i) => i.envioNumero === numero && i.esAdicion),
      ),
      trabajos: lista,
    }));
  if (otros.length > 0) {
    grupos.push({ clave: 'otros', titulo: 'Marchas, anulaciones y pre-cuentas', trabajos: otros });
  }
  return grupos;
}
