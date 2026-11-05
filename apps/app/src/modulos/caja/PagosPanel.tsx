import { MAXIMO_PAGOS_COBRO, type MedioPago } from '@restaurante/dominio';
import {
  BotonIcono,
  Boton,
  CampoMonto,
  CampoTexto,
  IconoCerrar,
  IconoMas,
  Segmentos,
} from '@restaurante/ui';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { montoEnSoles } from '../../lib/monto';
import {
  MEDIOS,
  billetesQueAlcanzan,
  indiceDelResto,
  type PagoEscrito,
  type ResumenDePagos,
} from './cobro';

export const pagoNuevo = (medio: MedioPago): PagoEscrito => ({
  clave: nuevaClaveDeIdempotencia(),
  medio,
  monto: '',
  recibido: '',
  operacion: '',
});

interface Props {
  filas: PagoEscrito[];
  onFilas: (filas: PagoEscrito[]) => void;
  resumen: ResumenDePagos;
  /** Muestra los problemas de cada pago (después de intentar cobrar o de escribir). */
  verProblemas: boolean;
}

/**
 * Los pagos del cobro (criterio 112): botones grandes por medio; el efectivo con «Recibido» y atajos de billetes, el
 * vuelto en grande y el redondeo a la vista; los demás medios con su número de operación; «Agregar otro pago» para
 * combinar. El efectivo cubre el resto (así su redondeo es el del dominio); sin efectivo, lo cubre el primer pago.
 */
export function PagosPanel({ filas, onFilas, resumen, verProblemas }: Props) {
  const hayEfectivo = filas.some((f) => f.medio === 'EFECTIVO');
  const resto = indiceDelResto(filas);
  const sumar = filas.length < MAXIMO_PAGOS_COBRO;

  /** Si cambia la fila que cubre el resto, la que lo cubría conserva el monto que tenía, ya calculado. */
  function conservarElResto(antes: number, despues: PagoEscrito[]): PagoEscrito[] {
    const nuevoResto = indiceDelResto(despues);
    const anterior = filas[antes];
    if (!anterior || nuevoResto === antes) return despues;
    return despues.map((f) =>
      f.clave === anterior.clave && f.monto === ''
        ? { ...f, monto: resumen.filas[antes]?.monto ?? '' }
        : f,
    );
  }

  function cambiar(i: number, cambio: Partial<PagoEscrito>) {
    onFilas(filas.map((f, k) => (k === i ? { ...f, ...cambio } : f)));
  }

  function cambiarMedio(i: number, medio: MedioPago) {
    const despues = filas.map((f, k) =>
      k === i
        ? { ...f, medio, recibido: medio === 'EFECTIVO' ? f.recibido : '', operacion: f.operacion }
        : f,
    );
    onFilas(conservarElResto(resto, despues));
  }

  function agregar() {
    const medio: MedioPago = hayEfectivo ? 'YAPE' : 'EFECTIVO';
    onFilas(conservarElResto(resto, [...filas, pagoNuevo(medio)]));
  }

  function quitar(i: number) {
    const despues = filas.filter((_, k) => k !== i);
    // Quitar la fila del resto deja el resto a la que le toque; no hay monto que conservar.
    onFilas(i === resto ? despues : conservarElResto(resto, despues));
  }

  return (
    <div className="cobro__bloque">
      <ul className="pagos" aria-label="Pagos">
        {filas.map((fila, i) => {
          const calculada = resumen.filas[i];
          const esResto = i === resto;
          const otroEfectivo = filas.some((f, k) => k !== i && f.medio === 'EFECTIVO');
          const opciones = MEDIOS.filter((m) => m.medio !== 'EFECTIVO' || !otroEfectivo).map(
            (m) => ({ valor: m.medio, etiqueta: m.nombre }),
          );
          const problema = verProblemas ? calculada?.problema : undefined;
          return (
            <li key={fila.clave}>
              <div className="pago">
                <div className="pago__cabecera">
                  <b>{filas.length > 1 ? `Pago ${i + 1}` : 'Cómo paga'}</b>
                  {filas.length > 1 ? (
                    <BotonIcono
                      icono={IconoCerrar}
                      etiqueta={`Quitar el pago ${i + 1}`}
                      onClick={() => quitar(i)}
                    />
                  ) : null}
                </div>
                <Segmentos
                  etiqueta={`Medio del pago ${i + 1}`}
                  opciones={opciones}
                  valor={fila.medio}
                  onCambio={(medio) => cambiarMedio(i, medio)}
                />

                {esResto ? (
                  <div className="pago__cobra">
                    <span>{fila.medio === 'EFECTIVO' ? 'Efectivo a cobrar' : 'Cobra'}</span>
                    <b>{montoEnSoles(calculada?.monto) ?? '—'}</b>
                  </div>
                ) : (
                  <CampoMonto
                    etiqueta={`Monto del pago ${i + 1}`}
                    value={fila.monto}
                    onValor={(monto) => cambiar(i, { monto })}
                  />
                )}

                {fila.medio === 'EFECTIVO' ? (
                  <>
                    <CampoMonto
                      etiqueta="Recibido"
                      ayuda="Déjalo vacío si pagó exacto."
                      value={fila.recibido}
                      onValor={(recibido) => cambiar(i, { recibido })}
                    />
                    <div className="pago__billetes" role="group" aria-label="Billetes recibidos">
                      <Boton onClick={() => cambiar(i, { recibido: '' })}>Exacto</Boton>
                      {billetesQueAlcanzan(calculada?.monto ?? null).map((b) => (
                        <Boton key={b} onClick={() => cambiar(i, { recibido: b })}>
                          {montoEnSoles(b)?.replace('.00', '')}
                        </Boton>
                      ))}
                    </div>
                    {resumen.pagos !== null && resumen.vuelto !== '0.00' ? (
                      <div className="pago__vuelto" role="status">
                        <span>Vuelto</span>
                        <b>{montoEnSoles(resumen.vuelto)}</b>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <CampoTexto
                    etiqueta="Número de operación"
                    value={fila.operacion}
                    onChange={(e) =>
                      cambiar(i, {
                        operacion: e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
                      })
                    }
                    autoComplete="off"
                    autoCapitalize="characters"
                    ayuda="Lo ves en el voucher o en la constancia de la app."
                  />
                )}

                {problema ? (
                  <p className="pago__problema" role="alert">
                    {problema}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {resumen.redondeo !== '0.00' ? (
        <p className="pagos__redondeo" role="status">
          Redondeo a tu favor: <b>{montoEnSoles(resumen.redondeo)}</b>. El efectivo se cobra a la
          décima de sol.
        </p>
      ) : null}

      {sumar ? (
        <Boton icono={IconoMas} onClick={agregar}>
          Agregar otro pago
        </Boton>
      ) : null}
    </div>
  );
}
