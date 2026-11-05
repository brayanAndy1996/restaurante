import type { CuentaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  IconoNota,
  IconoPendiente,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL, useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { ETIQUETA_DE_ESTADO } from '../salon/ordenes';
import { rutaDeOrden } from '../salon/salon';
import { CortesiaHoja, DescuentoHoja } from './AjusteHoja';
import {
  admiteCortesia,
  admiteDescuento,
  claveDeCuenta,
  cortesiaDeLinea,
  falloDeCuenta,
  leerCuenta,
  quitarCortesia,
  quitarDescuento,
  sePuedeAjustar,
  textoDeDescuento,
  tituloDeCuenta,
  vistaPrevia,
} from './cuenta';
import './cuenta-caja.css';

type Linea = CuentaRespuesta['lineas'][number];

/** Lo que se está haciendo con la cuenta: una hoja abierta o una confirmación de quitar. */
type Accion =
  | { tipo: 'DESCUENTO'; linea: Linea | null }
  | { tipo: 'CORTESIA'; linea: Linea }
  | {
      tipo: 'QUITAR';
      /** Qué se quita y cómo se llama en la confirmación. */
      que: 'descuento' | 'cortesia';
      id: string;
      itemId: string | null;
      titulo: string;
    };

/** Desde dónde se llegó, para volver al mismo lugar. */
interface EstadoDeLlegada {
  desde?: 'caja';
}

/**
 * `/caja/cuentas/:id`: la cuenta con su desglose, y «Descuento» y «Cortesía» por ítem y para toda la cuenta
 * (criterios 36 a 46 y 111 de 006). La abren la cuenta de la mesa (el Mozo y el Cajero) y «Por cobrar» de la caja.
 * Todos los montos son los de `GET /cuentas/:ordenId`; la pantalla no suma nada.
 */
export function CuentaPagina() {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  const ubicacion = useLocation();
  const llegada = (ubicacion.state as EstadoDeLlegada | null) ?? {};
  const atras =
    llegada.desde === 'caja'
      ? { a: '/caja?ver=por-cobrar', etiqueta: 'Caja' }
      : { a: rutaDeOrden(id), etiqueta: 'Cuenta' };
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Cuenta" atras={atras}>
        <EstadoVacio icono={IconoNota} titulo="Elige una sucursal">
          Las cuentas son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return <Cuenta key={`${id}.${sesion.sucursal.id}`} ordenId={id} atras={atras} />;
}

function Cuenta({ ordenId, atras }: { ordenId: string; atras: { a: string; etiqueta: string } }) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const consulta = useQuery({
    queryKey: claveDeCuenta(ordenId),
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: ({ signal }) =>
      leerCuenta(ordenId, signal, clientes.getQueryData(claveDeCuenta(ordenId)) !== undefined),
  });
  const cuenta = consulta.data;
  const puedeDescuento = usePermiso('APLICAR_DESCUENTO') !== 'prohibido';
  const puedeCortesia = usePermiso('APLICAR_CORTESIA') !== 'prohibido';
  const puedeQuitar = usePermiso('ATENDER_MESA') !== 'prohibido';

  const [accion, setAccion] = useState<Accion | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [falloAlQuitar, setFalloAlQuitar] = useState<string | null>(null);

  if (consulta.error instanceof ErrorApi && !cuenta) {
    const e = consulta.error;
    if (e.codigo === 'NO_ENCONTRADO' || e.codigo === 'PROHIBIDO' || e.estado === 403) {
      return (
        <Pagina titulo="Cuenta" atras={atras}>
          <EstadoVacio
            icono={IconoNota}
            titulo={
              e.codigo === 'NO_ENCONTRADO' ? 'Esta cuenta no existe' : 'No puedes ver esta cuenta'
            }
          >
            {e.codigo === 'NO_ENCONTRADO'
              ? 'Puede que se haya anulado o que no sea de esta sucursal. Vuelve atrás.'
              : 'Tu rol o el plan de la sucursal no incluye esta pantalla.'}
          </EstadoVacio>
        </Pagina>
      );
    }
  }
  if (!cuenta) {
    return (
      <Pagina titulo="Cuenta" atras={atras}>
        {consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar la cuenta"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : (
          <EsqueletoDeLista filas={4} conInicial={false} etiqueta="Cargando la cuenta" />
        )}
      </Pagina>
    );
  }

  const ajustable = sePuedeAjustar(cuenta);
  const etiqueta = ETIQUETA_DE_ESTADO[cuenta.estado];
  const cuentaMarcada = cuenta.descuentoCuenta;

  function refrescar() {
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
  }

  async function confirmarQuitar(a: Extract<Accion, { tipo: 'QUITAR' }>) {
    if (quitando) return;
    setQuitando(true);
    setFalloAlQuitar(null);
    try {
      if (a.que === 'descuento') await quitarDescuento(ordenId, a.id);
      else await quitarCortesia(ordenId, a.id);
      refrescar();
      setAccion(null);
      setHecho(a.que === 'descuento' ? 'Quitaste el descuento.' : 'Quitaste la cortesía.');
    } catch (error) {
      if (error instanceof ErrorApi && error.estado >= 400) refrescar();
      setFalloAlQuitar(falloDeCuenta(error)?.texto ?? mensajeDeError(error));
    } finally {
      setQuitando(false);
    }
  }

  return (
    <Pagina titulo={tituloDeCuenta(cuenta)} atras={atras}>
      {consulta.isError ? (
        <Aviso tipo="alerta" titulo="No pudimos actualizar la cuenta">
          Lo que ves puede estar desactualizado. Seguimos intentando.
        </Aviso>
      ) : null}
      {hecho ? (
        <div role="status">
          <Aviso tipo="ok" titulo="Hecho">
            {hecho}
          </Aviso>
        </div>
      ) : null}

      <div className="cuentacaja">
        <header className="cuentacaja__cabecera">
          <EtiquetaDeEstado tono={etiqueta.tono}>{etiqueta.texto}</EtiquetaDeEstado>
          {cuenta.mozo ? <p className="cuentacaja__datos">Atiende {cuenta.mozo.nombre}</p> : null}
        </header>

        {cuenta.cobros.length > 0 ? (
          <Aviso tipo="info" titulo="Esta cuenta ya tiene cobros">
            Los descuentos y las cortesías ya no se pueden cambiar.
          </Aviso>
        ) : cuenta.estado === 'UNIDA' ? (
          <Aviso tipo="alerta" titulo="Esta cuenta se unió a otra">
            Sus ítems pasaron a la cuenta principal.
          </Aviso>
        ) : !ajustable ? (
          <Aviso tipo="alerta" titulo="Esta cuenta ya no está abierta">
            Solo puedes mirarla.
          </Aviso>
        ) : null}

        {cuenta.lineas.length === 0 ? (
          <EstadoVacio icono={IconoPendiente} titulo="Aún no hay nada que cobrar">
            Cuando se envíe algo a cocina, aparecerá aquí.
          </EstadoVacio>
        ) : (
          <ul className="cuentacaja__lineas" aria-label="Ítems de la cuenta">
            {cuenta.lineas.map((linea) => (
              <li key={linea.itemId}>
                <FilaDeLinea
                  cuenta={cuenta}
                  linea={linea}
                  ofrecerDescuento={ajustable && puedeDescuento && admiteDescuento(linea)}
                  ofrecerCortesia={ajustable && puedeCortesia && admiteCortesia(linea)}
                  ofrecerQuitar={ajustable && puedeQuitar}
                  alElegir={(a) => {
                    setHecho(null);
                    setFalloAlQuitar(null);
                    setAccion(a);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {cuentaMarcada || (ajustable && puedeDescuento && cuenta.lineas.length > 0) ? (
          <section className="cuentacaja__cuenta" aria-label="Descuento de la cuenta">
            {cuentaMarcada ? (
              <div className="ajuste-aplicado">
                <span className="ajuste-aplicado__texto">
                  <b>
                    Descuento a la cuenta ·{' '}
                    {textoDeDescuento(cuentaMarcada.tipo, cuentaMarcada.valor)}
                  </b>
                  <span className="texto-ayuda">
                    −{montoEnSoles(cuentaMarcada.monto)} · {cuentaMarcada.motivo}
                  </span>
                </span>
                {ajustable && puedeQuitar ? (
                  <Boton
                    className="ajuste-aplicado__quitar"
                    aria-label="Quitar el descuento de la cuenta"
                    onClick={() => {
                      setHecho(null);
                      setFalloAlQuitar(null);
                      setAccion({
                        tipo: 'QUITAR',
                        que: 'descuento',
                        id: cuentaMarcada.id,
                        itemId: null,
                        titulo: 'el descuento de la cuenta',
                      });
                    }}
                  >
                    Quitar
                  </Boton>
                ) : null}
              </div>
            ) : (
              <Boton
                bloque
                onClick={() => {
                  setHecho(null);
                  setAccion({ tipo: 'DESCUENTO', linea: null });
                }}
              >
                Descuento a la cuenta
              </Boton>
            )}
          </section>
        ) : null}

        {cuenta.lineas.length > 0 ? <Desglose cuenta={cuenta} /> : null}
      </div>

      {accion?.tipo === 'DESCUENTO' ? (
        <DescuentoHoja
          key={accion.linea?.itemId ?? 'cuenta'}
          cuenta={cuenta}
          linea={accion.linea}
          onCerrar={() => setAccion(null)}
          onHecho={(texto) => {
            setAccion(null);
            setHecho(texto);
          }}
        />
      ) : null}
      {accion?.tipo === 'CORTESIA' ? (
        <CortesiaHoja
          key={accion.linea.itemId}
          cuenta={cuenta}
          linea={accion.linea}
          onCerrar={() => setAccion(null)}
          onHecho={(texto) => {
            setAccion(null);
            setHecho(texto);
          }}
        />
      ) : null}
      {accion?.tipo === 'QUITAR' ? (
        <ConfirmarQuitar
          cuenta={cuenta}
          accion={accion}
          cargando={quitando}
          fallo={falloAlQuitar}
          onConfirmar={() => void confirmarQuitar(accion)}
          onCancelar={() => {
            if (!quitando) setAccion(null);
          }}
        />
      ) : null}
      {falloAlQuitar && accion === null ? (
        <Aviso tipo="error" titulo="No pudimos quitarlo">
          {falloAlQuitar}
        </Aviso>
      ) : null}
    </Pagina>
  );
}

function FilaDeLinea({
  cuenta,
  linea,
  ofrecerDescuento,
  ofrecerCortesia,
  ofrecerQuitar,
  alElegir,
}: {
  cuenta: CuentaRespuesta;
  linea: Linea;
  ofrecerDescuento: boolean;
  ofrecerCortesia: boolean;
  ofrecerQuitar: boolean;
  alElegir: (accion: Accion) => void;
}) {
  const cortesia = cortesiaDeLinea(cuenta, linea.itemId);
  const descuento = linea.descuento;
  return (
    <div className="linea">
      <div className="linea__cabecera">
        <span className="linea__cantidad">{linea.cantidad} ×</span>
        <span className="linea__texto">
          <span className="linea__nombre">{linea.nombre}</span>
          {linea.modificadores.length > 0 ? (
            <span className="linea__detalle">{linea.modificadores.join(' · ')}</span>
          ) : null}
        </span>
        <span className="linea__importe">{montoEnSoles(linea.bruto)}</span>
      </div>

      <ul className="ajustes">
        {descuento ? (
          <li className="ajuste-aplicado">
            <span className="ajuste-aplicado__texto">
              <b>Descuento {textoDeDescuento(descuento.tipo, descuento.valor)}</b>
              <span className="texto-ayuda">
                −{montoEnSoles(descuento.monto)} · {descuento.motivo}
              </span>
            </span>
            {ofrecerQuitar ? (
              <Boton
                className="ajuste-aplicado__quitar"
                aria-label={`Quitar el descuento de ${linea.nombre}`}
                onClick={() =>
                  alElegir({
                    tipo: 'QUITAR',
                    que: 'descuento',
                    id: descuento.id,
                    itemId: linea.itemId,
                    titulo: `el descuento de ${linea.nombre}`,
                  })
                }
              >
                Quitar
              </Boton>
            ) : null}
          </li>
        ) : null}
        {cortesia ? (
          <li className="ajuste-aplicado">
            <span className="ajuste-aplicado__texto">
              <b>
                Cortesía · {cortesia.cantidad} {cortesia.cantidad === 1 ? 'unidad' : 'unidades'}
              </b>
              <span className="texto-ayuda">
                Sin cobro, valía {montoEnSoles(cortesia.valorReferencial)} · {cortesia.motivo}
              </span>
            </span>
            {ofrecerQuitar ? (
              <Boton
                className="ajuste-aplicado__quitar"
                aria-label={`Quitar la cortesía de ${linea.nombre}`}
                onClick={() =>
                  alElegir({
                    tipo: 'QUITAR',
                    que: 'cortesia',
                    id: cortesia.id,
                    itemId: linea.itemId,
                    titulo: `la cortesía de ${linea.nombre}`,
                  })
                }
              >
                Quitar
              </Boton>
            ) : null}
          </li>
        ) : null}
      </ul>

      <div className="linea__acciones">
        {ofrecerDescuento ? (
          <Boton
            aria-label={`Descuento a ${linea.nombre}`}
            onClick={() => alElegir({ tipo: 'DESCUENTO', linea })}
          >
            Descuento
          </Boton>
        ) : null}
        {ofrecerCortesia ? (
          <Boton
            aria-label={`Cortesía de ${linea.nombre}`}
            onClick={() => alElegir({ tipo: 'CORTESIA', linea })}
          >
            Cortesía
          </Boton>
        ) : null}
      </div>
    </div>
  );
}

/** El desglose de la cuenta con las cifras de la API (criterio 111): subtotal, descuentos, cortesías, ICBPER y total. */
function Desglose({ cuenta }: { cuenta: CuentaRespuesta }) {
  const { totales } = cuenta;
  const nombreDe = (itemId: string) =>
    cuenta.lineas.find((l) => l.itemId === itemId)?.nombre ?? 'Ítem';
  return (
    <dl className="desglose" aria-label="Desglose de la cuenta">
      <Fila etiqueta="Subtotal" valor={montoEnSoles(totales.subtotal)} />
      {!montoEsCero(totales.descuentos) ? (
        <Fila etiqueta="Descuentos" valor={`−${montoEnSoles(totales.descuentos)}`} />
      ) : null}
      {cuenta.cortesias.map((c) => (
        <Fila
          key={c.id}
          etiqueta={`Cortesía · ${c.cantidad} × ${nombreDe(c.itemId)}`}
          valor={`Sin cobro (${montoEnSoles(c.valorReferencial)})`}
          ayuda
        />
      ))}
      {!montoEsCero(totales.icbper) ? (
        <Fila etiqueta="ICBPER" valor={montoEnSoles(totales.icbper)} />
      ) : null}
      <Fila etiqueta="Total" valor={montoEnSoles(totales.total)} total />
      {cuenta.parametros.tasaIgv !== null ? (
        <Fila etiqueta="Incluye IGV" valor={montoEnSoles(totales.igv)} ayuda />
      ) : null}
      {!montoEsCero(cuenta.cobrado) ? (
        <>
          <Fila etiqueta="Cobrado" valor={montoEnSoles(cuenta.cobrado)} />
          <Fila etiqueta="Por cobrar" valor={montoEnSoles(cuenta.saldo)} />
        </>
      ) : null}
    </dl>
  );
}

function Fila({
  etiqueta,
  valor,
  ayuda,
  total,
}: {
  etiqueta: string;
  valor: string | null;
  ayuda?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={
        total
          ? 'desglose__fila desglose__fila--total'
          : ayuda
            ? 'desglose__fila desglose__fila--ayuda'
            : 'desglose__fila'
      }
    >
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

/** «¿Quitar el descuento de Lomo saltado?»: sin clave, con lo que pasa con el total (criterio 42). */
function ConfirmarQuitar({
  cuenta,
  accion,
  cargando,
  fallo,
  onConfirmar,
  onCancelar,
}: {
  cuenta: CuentaRespuesta;
  accion: Extract<Accion, { tipo: 'QUITAR' }>;
  cargando: boolean;
  fallo: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const previa = vistaPrevia(
    cuenta,
    accion.que === 'descuento'
      ? { tipo: 'QUITAR_DESCUENTO', itemId: accion.itemId }
      : { tipo: 'QUITAR_CORTESIA', itemId: accion.itemId ?? '' },
  );
  return (
    <DialogoConfirmacion
      abierta
      titulo={`¿Quitar ${accion.titulo}?`}
      etiquetaConfirmar={
        accion.que === 'descuento' ? 'Sí, quitar el descuento' : 'Sí, quitar la cortesía'
      }
      peligro
      cargando={cargando}
      textoCargando="Quitando…"
      error={
        fallo ? (
          <Aviso tipo="error" titulo="No pudimos quitarlo">
            {fallo}
          </Aviso>
        ) : null
      }
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    >
      <p>
        {previa && previa.ok
          ? `El total sube de ${montoEnSoles(previa.totalAntes)} a ${montoEnSoles(previa.totalDespues)}. `
          : ''}
        No hace falta la clave del supervisor. Si después lo quieres de nuevo, hay que volver a
        pedirla.
      </p>
    </DialogoConfirmacion>
  );
}
