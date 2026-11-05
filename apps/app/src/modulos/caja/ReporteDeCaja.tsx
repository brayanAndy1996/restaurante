import type { ReporteCaja } from '@restaurante/contratos';
import { MEDIOS_PAGO } from '@restaurante/dominio';
import { EtiquetaDeEstado, IconoOk } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { montoEsCero } from '../../lib/monto';
import { NOMBRE_DE_MEDIO, horaDelTurno, textoDeDiferencia, soles } from './turno';

function Fila({
  etiqueta,
  valor,
  ayuda,
  fuerte,
}: {
  etiqueta: string;
  valor: string;
  ayuda?: string;
  fuerte?: boolean;
}) {
  return (
    <div className={fuerte ? 'reporte__fila reporte__fila--fuerte' : 'reporte__fila'}>
      <dt className="reporte__etiqueta">
        {etiqueta}
        {ayuda ? <span className="reporte__ayuda">{ayuda}</span> : null}
      </dt>
      <dd className="reporte__valor">{valor}</dd>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="reporte__bloque">
      <h3 className="reporte__titulo">{titulo}</h3>
      <dl className="reporte__lista">{children}</dl>
    </section>
  );
}

const cantidadDe = (n: number, uno: string, varios: string) =>
  n === 1 ? `1 ${uno}` : `${n} ${varios}`;

/**
 * El reporte de caja en pantalla (criterio 29 de 006): lo vendido, lo cobrado por medio, los movimientos y lo que
 * debería haber de cada medio. Es el X de un turno abierto y, con `cierre`, el Z de uno cerrado, que además trae lo
 * contado y la diferencia de cada medio. Todas las cifras llegan calculadas por la API: aquí solo se muestran.
 */
export function ReporteDeCaja({ reporte }: { reporte: ReporteCaja }) {
  const { ventas, movimientos, cierre } = reporte;
  const hoy = (instante: string) => horaDelTurno(instante);
  return (
    <div className="reporte">
      <p className="texto-ayuda reporte__hora" role="status">
        {cierre
          ? `Cerrado a las ${hoy(cierre.cerradoEn)} por ${cierre.cerradoPor.nombre}`
          : `Generado a las ${hoy(reporte.generadoEn)}`}
      </p>

      {cierre ? (
        <section className="reporte__bloque reporte__cierre" aria-labelledby="reporte-conteo">
          <h3 className="reporte__titulo" id="reporte-conteo">
            Conteo del cierre
          </h3>
          <ul className="reporte__conteo">
            {cierre.conteo.map((c) => (
              <li key={c.medio} className="reporte__medio">
                <div className="reporte__medio-cabecera">
                  <b>{NOMBRE_DE_MEDIO[c.medio]}</b>
                  {montoEsCero(c.diferencia) ? (
                    <EtiquetaDeEstado tono="ok" icono={IconoOk}>
                      Cuadra
                    </EtiquetaDeEstado>
                  ) : (
                    <EtiquetaDeEstado tono="alerta">
                      {textoDeDiferencia(c.diferencia)}
                    </EtiquetaDeEstado>
                  )}
                </div>
                <dl className="reporte__lista">
                  <Fila etiqueta="Esperado" valor={soles(c.esperado)} />
                  <Fila etiqueta="Contado" valor={soles(c.contado)} />
                </dl>
                {c.motivo ? <p className="texto-ayuda">{`Motivo: ${c.motivo}`}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="reporte__bloques">
        <Bloque titulo="Ventas">
          <Fila
            etiqueta="Total vendido"
            ayuda={cantidadDe(ventas.cantidad, 'comprobante', 'comprobantes')}
            valor={soles(ventas.total)}
            fuerte
          />
          {ventas.porTipo.map((t) => (
            <Fila
              key={t.tipo}
              etiqueta={t.tipo === 'BOLETA' ? 'Boletas' : 'Facturas'}
              ayuda={String(t.cantidad)}
              valor={soles(t.total)}
            />
          ))}
          <Fila etiqueta="Descuentos" valor={soles(ventas.descuentos)} />
          <Fila etiqueta="Cortesías" valor={soles(ventas.cortesias)} />
          <Fila etiqueta="IGV" valor={soles(ventas.igv)} />
          <Fila etiqueta="ICBPER" valor={soles(ventas.icbper)} />
          <Fila etiqueta="Redondeos" valor={soles(ventas.redondeos)} />
          <Fila etiqueta="Vueltos" valor={soles(ventas.vueltos)} />
        </Bloque>

        <Bloque titulo="Cobrado por medio de pago">
          {MEDIOS_PAGO.map((medio) => {
            const fila = ventas.porMedio.find((m) => m.medio === medio);
            return (
              <Fila
                key={medio}
                etiqueta={NOMBRE_DE_MEDIO[medio]}
                ayuda={cantidadDe(fila?.cantidad ?? 0, 'pago', 'pagos')}
                valor={soles(fila?.monto ?? '0.00')}
              />
            );
          })}
        </Bloque>

        <Bloque titulo="Efectivo que entró o salió">
          <Fila etiqueta="Fondo inicial" valor={soles(reporte.fondo)} />
          <Fila etiqueta="Ingresos" valor={soles(movimientos.ingresos)} />
          <Fila etiqueta="Egresos" valor={soles(movimientos.egresos)} />
        </Bloque>

        {cierre ? null : (
          <Bloque titulo="Lo que debería haber en caja">
            {MEDIOS_PAGO.map((medio) => (
              <Fila
                key={medio}
                etiqueta={NOMBRE_DE_MEDIO[medio]}
                valor={soles(reporte.esperado.find((e) => e.medio === medio)?.monto ?? '0.00')}
              />
            ))}
          </Bloque>
        )}
      </div>
    </div>
  );
}
