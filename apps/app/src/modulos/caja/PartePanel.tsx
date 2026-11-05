import type { CuentaRespuesta } from '@restaurante/contratos';
import { MAXIMO_PARTES_IGUALES } from '@restaurante/dominio';
import { ContadorGrande, SelectorDeCantidad, Segmentos, EtiquetaDeEstado } from '@restaurante/ui';
import { montoEnSoles } from '../../lib/monto';
import { unidadesPorCobrar, type ParteDePantalla } from './cobro';

export type ModoDeCobro = 'TOTAL' | 'ITEMS' | 'IGUALES';

/**
 * Las partes iguales que la cuenta ya cobró, con el número de su comprobante (en orden). Salen de `cuenta.cobros`, así
 * que son las mismas desde cualquier equipo; con `partesElegidas` (las que faltan) dan el total de la división.
 */
export interface PlanDeIguales {
  pagadas: string[];
}

interface Props {
  cuenta: CuentaRespuesta;
  /** Se puede dividir por ítems (no después de partes iguales). */
  porItems: boolean;
  modo: ModoDeCobro;
  onModo: (modo: ModoDeCobro) => void;
  unidades: Readonly<Record<string, number>>;
  onUnidades: (unidades: Record<string, number>) => void;
  /** Cuántas partes iguales faltan por pagar, contando la que se cobra ahora. */
  partesElegidas: number;
  onPartesElegidas: (partes: number) => void;
  plan: PlanDeIguales;
  parte: ParteDePantalla;
}

const MENSAJE_DE_PARTE: Record<Extract<ParteDePantalla, { ok: false }>['motivo'], string> = {
  VACIA: 'Elige al menos una unidad para cobrar.',
  INVALIDA: 'Esa parte no se puede cobrar así. Elige otra.',
  NADA_QUE_COBRAR: 'No queda nada por cobrar en esta cuenta.',
  DESCUADRADA:
    'Los cobros anteriores ya no cuadran con la cuenta. Actualiza la pantalla o cobra lo que falta.',
};

/** «Qué cobras» (criterios 64 a 68 y 113): toda la cuenta, unidades elegidas por ítem o partes iguales. */
export function PartePanel({
  cuenta,
  porItems,
  modo,
  onModo,
  unidades,
  onUnidades,
  partesElegidas,
  onPartesElegidas,
  plan,
  parte,
}: Props) {
  const conCobros = cuenta.cobros.length > 0;
  // Después de partes iguales solo siguen partes iguales («Lo que falta» es la última), sin elegir el modo.
  const opciones: { valor: ModoDeCobro; etiqueta: string }[] = porItems
    ? [
        { valor: 'TOTAL', etiqueta: conCobros ? 'Lo que falta' : 'Toda la cuenta' },
        { valor: 'ITEMS', etiqueta: 'Por ítems' },
        { valor: 'IGUALES', etiqueta: 'Partes iguales' },
      ]
    : [];
  const lineas = cuenta.lineas.filter((l) => unidadesPorCobrar(l) > 0);

  return (
    <section className="cobro__bloque" aria-labelledby="cobro-que">
      <h2 id="cobro-que">Qué cobras</h2>
      {opciones.length > 1 ? (
        <Segmentos
          etiqueta="Qué parte de la cuenta se cobra"
          opciones={opciones}
          valor={modo}
          onCambio={onModo}
        />
      ) : null}

      {modo === 'ITEMS' ? (
        <ul className="cobro__lista" aria-label="Unidades por cobrar">
          {lineas.map((linea) => {
            const maximo = unidadesPorCobrar(linea);
            return (
              <li key={linea.itemId}>
                <div className="cobro__fila">
                  <span className="cobro__fila-texto">
                    <b>{linea.nombre}</b>
                    <span className="texto-ayuda">
                      {maximo === 1 ? 'Queda 1 por cobrar' : `Quedan ${maximo} por cobrar`}
                      {linea.modificadores.length > 0
                        ? ` · ${linea.modificadores.join(' · ')}`
                        : ''}
                    </span>
                  </span>
                  <SelectorDeCantidad
                    nombre={linea.nombre}
                    valor={unidades[linea.itemId] ?? 0}
                    minimo={0}
                    maximo={maximo}
                    onCambio={(valor) => onUnidades({ ...unidades, [linea.itemId]: valor })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {modo === 'IGUALES' ? (
        <div className="cobro__bloque">
          {plan.pagadas.length > 0 ? (
            <ul className="cobro__lista" aria-label="Partes de la cuenta">
              {Array.from({ length: plan.pagadas.length + partesElegidas }, (_, i) => {
                const pagada = plan.pagadas[i];
                const actual = i === plan.pagadas.length;
                return (
                  <li key={i}>
                    <div className={`cobro__fila${actual ? ' cobro__fila--actual' : ''}`}>
                      <span className="cobro__fila-texto">
                        <b>{`Parte ${i + 1} de ${plan.pagadas.length + partesElegidas}`}</b>
                      </span>
                      {pagada ? (
                        <EtiquetaDeEstado tono="ok">{`Pagada · ${pagada}`}</EtiquetaDeEstado>
                      ) : actual ? (
                        <span className="cobro__fila-monto">
                          {parte.ok ? montoEnSoles(parte.total) : 'Por cobrar'}
                        </span>
                      ) : (
                        <EtiquetaDeEstado tono="neutro">Pendiente</EtiquetaDeEstado>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ContadorGrande
            nombre={plan.pagadas.length > 0 ? 'partes que faltan' : 'partes'}
            unidad={plan.pagadas.length > 0 ? 'partes por pagar' : 'partes iguales'}
            valor={partesElegidas}
            minimo={plan.pagadas.length > 0 ? 1 : 2}
            maximo={MAXIMO_PARTES_IGUALES}
            onCambio={onPartesElegidas}
          />
          <p className="texto-ayuda" role="status">
            {parte.ok
              ? partesElegidas === 1
                ? `Esta es la última parte: ${montoEnSoles(parte.total) ?? ''}, lo que falta de la cuenta.`
                : `Cada parte es de ${montoEnSoles(parte.total) ?? ''} (la última toma lo que falte).`
              : MENSAJE_DE_PARTE[parte.motivo]}
          </p>
        </div>
      ) : null}

      {!parte.ok && modo !== 'IGUALES' ? (
        <p className="texto-ayuda" role="status">
          {MENSAJE_DE_PARTE[parte.motivo]}
        </p>
      ) : null}
    </section>
  );
}
