import type { EstadoTrabajo } from '@restaurante/contratos';
import {
  Aviso,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoImpresora,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { mensajeDeError } from '../../../lib/errores';
import { ListaDeTrabajos } from '../../impresion/ListaDeTrabajos';
import { claveTrabajos, listarTrabajos, useReimpresion } from '../../impresion/trabajos';

/**
 * "Vencidos" no es un filtro: la lista es del día operativo y un trabajo vence al pasar el día, así que a
 * esa hora ya no está en la lista. Un ticket vencido de hoy se ve igual en "Todos", con su etiqueta.
 */
type Filtro = Exclude<EstadoTrabajo, 'VENCIDO'> | 'todos';

const FILTROS: readonly OpcionDeSegmento<Filtro>[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'PENDIENTE', etiqueta: 'Pendientes' },
  { valor: 'IMPRESO', etiqueta: 'Impresos' },
];

const VACIO: Record<Filtro, string> = {
  todos: 'Aún no se mandó nada a imprimir hoy. Los tickets aparecen aquí apenas se envían.',
  PENDIENTE: 'No hay tickets pendientes: todo lo que se mandó ya se imprimió.',
  IMPRESO: 'Todavía no se imprimió ningún ticket hoy.',
};

/** Cada cuánto se vuelve a pedir la lista mientras se mira (los tickets pasan de pendiente a impreso). */
const PERIODO_DE_LA_LISTA_MS = 20_000;

/**
 * Ajustes › Impresión › Trabajos de hoy (criterios 128 y 139): lo que se mandó a imprimir en el día
 * operativo de la sucursal, con filtro por estado y "Reimprimir". Reimprimir crea un trabajo nuevo con la
 * marca "REIMPRESIÓN" y no toca el original.
 */
export function TrabajosDeHoy({ sucursalId }: { sucursalId: string }) {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const reimpresion = useReimpresion();
  const consulta = useQuery({
    queryKey: claveTrabajos(sucursalId, filtro),
    queryFn: ({ signal }) => listarTrabajos(filtro === 'todos' ? {} : { estado: filtro }, signal),
    refetchInterval: PERIODO_DE_LA_LISTA_MS,
  });
  const trabajos = consulta.data;

  return (
    <section className="impresion__bloque" aria-labelledby="impresion-trabajos">
      <div className="impresion__cabecera">
        <h3 className="formulario__titulo" id="impresion-trabajos">
          Trabajos de hoy
        </h3>
        <p className="texto-ayuda">
          Lo que se mandó a imprimir hoy en esta sucursal. Si un ticket no salió o se perdió, toca
          “Reimprimir”: sale una copia marcada como reimpresión.
        </p>
      </div>

      <Segmentos
        etiqueta="Filtrar los trabajos por estado"
        opciones={FILTROS}
        valor={filtro}
        onCambio={setFiltro}
      />

      <AvisoPendiente pendiente={reimpresion.pendiente} />
      {reimpresion.hecho ? (
        <Aviso tipo="ok" titulo="Reimpresión en cola">
          Sale en cuanto el puente la reciba. La verás en esta lista.
        </Aviso>
      ) : null}
      {reimpresion.fallo ? (
        <Aviso tipo="error" titulo="No pudimos reimprimir">
          {reimpresion.fallo.mensaje}
        </Aviso>
      ) : null}

      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando los trabajos" conInicial={false} filas={3} />
      ) : consulta.isError && !trabajos ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los trabajos"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : trabajos && trabajos.length === 0 ? (
        <EstadoVacio icono={IconoImpresora} titulo="Sin trabajos">
          {VACIO[filtro]}
        </EstadoVacio>
      ) : trabajos ? (
        <>
          <p className="texto-ayuda" aria-live="polite">
            {trabajos.length === 1 ? '1 trabajo' : `${trabajos.length} trabajos`}
          </p>
          <ListaDeTrabajos
            etiqueta="Trabajos de hoy"
            trabajos={trabajos}
            onReimprimir={(id) => void reimpresion.reimprimir(id)}
            enCurso={reimpresion.enCurso}
            pendiente={reimpresion.pendiente}
          />
        </>
      ) : null}
    </section>
  );
}
