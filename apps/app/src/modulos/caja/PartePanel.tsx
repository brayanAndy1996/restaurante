import type { CuentaRespuesta } from '@restaurante/contratos';
import { MAXIMO_PARTES_IGUALES } from '@restaurante/dominio';
import {
  Aviso,
  ContadorGrande,
  SelectorDeCantidad,
  Segmentos,
  EtiquetaDeEstado,
} from '@restaurante/ui';
import { montoEnSoles } from '../../lib/monto';
import { unidadesPorCobrar, type ParteDePantalla } from './cobro';

export type ModoDeCobro = 'TOTAL' | 'ITEMS' | 'IGUALES';

/** Cómo va la cuenta dividida en partes iguales: en cuántas, cuántas se pagaron y con qué comprobante. */
export interface PlanDeIguales {
  partes: number;
  numeros: string[];
}

interface Props {
  cuenta: CuentaRespuesta;
  /** `false`: hay cobros hechos desde otro equipo y solo se puede cobrar lo que falta. */
  sePuedeDividir: boolean;
  /** Se puede dividir por ítems (no después de partes iguales). */
  porItems: boolean;
  modo: ModoDeCobro;
  onModo: (modo: ModoDeCobro) => void;
  unidades: Readonly<Record<string, number>>;
  onUnidades: (unidades: Record<string, number>) => void;
  partesElegidas: number;
  onPartesElegidas: (partes: number) => void;
  plan: PlanDeIguales | null;
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
  sePuedeDividir,
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
  const opciones: { valor: ModoDeCobro; etiqueta: string }[] = [
    { valor: 'TOTAL', etiqueta: conCobros ? 'Lo que falta' : 'Toda la cuenta' },
    ...(sePuedeDividir && porItems ? [{ valor: 'ITEMS' as const, etiqueta: 'Por ítems' }] : []),
    ...(sePuedeDividir ? [{ valor: 'IGUALES' as const, etiqueta: 'Partes iguales' }] : []),
  ];
  const lineas = cuenta.lineas.filter((l) => unidadesPorCobrar(l) > 0);

  return (
    <section className="cobro__bloque" aria-labelledby="cobro-que">
      <h2 id="cobro-que">Qué cobras</h2>
      {!sePuedeDividir ? (
        <Aviso tipo="info" titulo="Esta cuenta se cobró en parte desde otro equipo">
          Aquí puedes cobrar lo que falta. Para seguir dividiendo, usa el equipo donde empezaste.
        </Aviso>
      ) : null}
      {opciones.length > 1 ? (
        <Segmentos
          etiqueta="Qué parte de la cuenta se cobra"
          opciones={opciones}
          valor={modo}
          onCambio={onModo}
        />
      ) : null}

      {modo === 'ITEMS' && sePuedeDividir ? (
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

      {modo === 'IGUALES' && sePuedeDividir ? (
        plan ? (
          <ul className="cobro__lista" aria-label="Partes de la cuenta">
            {Array.from({ length: plan.partes }, (_, i) => {
              const pagada = plan.numeros[i];
              const actual = i === plan.numeros.length;
              return (
                <li key={i}>
                  <div className={`cobro__fila${actual ? ' cobro__fila--actual' : ''}`}>
                    <span className="cobro__fila-texto">
                      <b>{`Parte ${i + 1} de ${plan.partes}`}</b>
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
        ) : (
          <div className="cobro__bloque">
            <ContadorGrande
              nombre="partes"
              unidad="partes iguales"
              valor={partesElegidas}
              minimo={2}
              maximo={MAXIMO_PARTES_IGUALES}
              onCambio={onPartesElegidas}
            />
            <p className="texto-ayuda" role="status">
              {parte.ok
                ? `Cada parte es de ${montoEnSoles(parte.total) ?? ''} (la última toma lo que falte).`
                : MENSAJE_DE_PARTE[parte.motivo]}
            </p>
          </div>
        )
      ) : null}

      {!parte.ok && modo !== 'IGUALES' ? (
        <p className="texto-ayuda" role="status">
          {MENSAJE_DE_PARTE[parte.motivo]}
        </p>
      ) : null}
    </section>
  );
}
