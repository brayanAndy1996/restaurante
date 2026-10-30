import type {
  EstacionDestinoRespuesta,
  ImpresionSucursalRespuesta,
  ImpresoraRespuesta,
} from '@restaurante/contratos';
import { Aviso, CampoSeleccion, EstadoVacio, IconoEstacion } from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MUTACION_SIN_PAUSA, type ExtraDeEscritura } from '../../../lib/envios';
import {
  NOTA_DE_BLUETOOTH,
  TEXTO_DE_KDS,
  claveDestinos,
  claveImpresoraDeCaja,
  conDestinoGuardado,
  configurarDestino,
  configurarImpresoraDeCaja,
  falloDeDestino,
} from './impresion';

const KDS = 'KDS';
const NINGUNA = '';

/** Enviar una escritura sin perderla por un corte (el `enviar` de `useEnvioPendiente`). */
type Enviar = <T>(ejecutar: (extra: ExtraDeEscritura) => Promise<T>) => Promise<T>;

/** Las impresoras que se pueden elegir: las activas y, si ya es la elegida, la desactivada que quedó. */
function opcionesDeImpresora(
  impresoras: readonly ImpresoraRespuesta[],
  elegidaId: string | undefined,
): ImpresoraRespuesta[] {
  return impresoras.filter((i) => i.activa || i.id === elegidaId);
}

function textoDeOpcion(impresora: ImpresoraRespuesta): string {
  const extras = [
    impresora.conexion.tipo === 'BLUETOOTH' ? 'Bluetooth' : null,
    impresora.activa ? null : 'inactiva',
  ].filter(Boolean);
  return extras.length > 0 ? `${impresora.nombre} (${extras.join(', ')})` : impresora.nombre;
}

const AYUDA_DE_BLUETOOTH = `${NOTA_DE_BLUETOOTH}: los tickets esperan en la cola hasta entonces.`;

// --- Dónde sale cada estación (criterios 99 y 100) -------------------------------------------------

interface PropsDestinos {
  sucursalId: string;
  destinos: readonly EstacionDestinoRespuesta[];
  impresoras: readonly ImpresoraRespuesta[];
  enviar: Enviar;
}

/**
 * Por estación de la carta, la pantalla de cocina o una impresora. Cada cambio se guarda al elegirlo y
 * vale desde el siguiente envío: las comandas ya enviadas conservan su destino.
 */
export function DondeSaleCadaEstacion({ sucursalId, destinos, impresoras, enviar }: PropsDestinos) {
  const clientes = useQueryClient();
  const [eligiendo, setEligiendo] = useState<Record<string, string>>({});
  const [confirmacion, setConfirmacion] = useState('');
  const [fallo, setFallo] = useState<{ estacion: string; mensaje: string } | null>(null);

  const guardar = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { estacionId: string; valor: string }) =>
      enviar((extra) =>
        configurarDestino(
          sucursalId,
          datos.estacionId,
          datos.valor === KDS
            ? { destino: 'KDS' }
            : { destino: 'IMPRESORA', impresoraId: datos.valor },
          extra,
        ),
      ),
  });

  async function elegir(destino: EstacionDestinoRespuesta, valor: string) {
    if (eligiendo[destino.estacionId] !== undefined) return;
    setConfirmacion('');
    setFallo(null);
    setEligiendo((e) => ({ ...e, [destino.estacionId]: valor }));
    try {
      const guardado = await guardar.mutateAsync({ estacionId: destino.estacionId, valor });
      clientes.setQueryData<EstacionDestinoRespuesta[]>(claveDestinos(sucursalId), (lista) =>
        conDestinoGuardado(lista ?? [], guardado),
      );
      setConfirmacion(
        guardado.destino === 'KDS' || !guardado.impresora
          ? `${guardado.nombre} sale ahora por la pantalla de cocina.`
          : `${guardado.nombre} sale ahora por ${guardado.impresora.nombre}.`,
      );
    } catch (error) {
      setFallo({ estacion: destino.nombre, mensaje: falloDeDestino(error) });
    } finally {
      setEligiendo((e) => {
        const { [destino.estacionId]: _quitada, ...resto } = e;
        return resto;
      });
      // El selector se desactiva mientras guarda: el foco vuelve a él para seguir con el teclado.
      requestAnimationFrame(() =>
        document.getElementById(`destino-${destino.estacionId}`)?.focus(),
      );
    }
  }

  return (
    <section className="impresion__bloque" aria-labelledby="impresion-destinos">
      <div className="impresion__cabecera">
        <h3 className="formulario__titulo" id="impresion-destinos">
          Dónde sale cada estación
        </h3>
        <p className="texto-ayuda">
          Elige si la comanda de cada estación se ve en la pantalla de cocina o se imprime. El
          cambio vale desde el siguiente envío; lo que ya se envió no se mueve.
        </p>
      </div>
      {fallo ? (
        <Aviso tipo="error" titulo={`No pudimos cambiar el destino de ${fallo.estacion}`}>
          {fallo.mensaje}
        </Aviso>
      ) : null}
      {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
      {destinos.length === 0 ? (
        <EstadoVacio icono={IconoEstacion} titulo="Aún no hay estaciones">
          Las estaciones (por ejemplo Cocina y Barra) se crean en la carta. Cuando existan, las
          verás aquí.
        </EstadoVacio>
      ) : (
        <div className="impresion__selectores">
          {destinos.map((destino) => {
            const actual =
              destino.destino === 'IMPRESORA' && destino.impresora ? destino.impresora.id : KDS;
            const valor = eligiendo[destino.estacionId] ?? actual;
            const guardando = eligiendo[destino.estacionId] !== undefined;
            const elegida = impresoras.find((i) => i.id === valor);
            return (
              <CampoSeleccion
                key={destino.estacionId}
                id={`destino-${destino.estacionId}`}
                etiqueta={destino.nombre}
                value={valor}
                disabled={guardando}
                aria-busy={guardando || undefined}
                onChange={(e) => void elegir(destino, e.target.value)}
                ayuda={
                  guardando
                    ? 'Guardando…'
                    : elegida?.conexion.tipo === 'BLUETOOTH'
                      ? AYUDA_DE_BLUETOOTH
                      : undefined
                }
              >
                <option value={KDS}>{TEXTO_DE_KDS}</option>
                {opcionesDeImpresora(impresoras, actual === KDS ? undefined : actual).map((i) => (
                  <option key={i.id} value={i.id}>
                    {textoDeOpcion(i)}
                  </option>
                ))}
              </CampoSeleccion>
            );
          })}
        </div>
      )}
      {impresoras.every((i) => !i.activa) && destinos.length > 0 ? (
        <p className="texto-ayuda">
          Todavía no tienes una impresora activa. Agrega una arriba para poder elegirla aquí.
        </p>
      ) : null}
    </section>
  );
}

// --- Impresora de caja (criterio 102) ------------------------------------------------------------------

interface PropsCaja {
  sucursalId: string;
  impresoraCajaId: string | null;
  impresoras: readonly ImpresoraRespuesta[];
  enviar: Enviar;
}

/** La impresora donde sale la pre-cuenta de las mesas; sin ella, la pre-cuenta solo se ve en pantalla. */
export function ImpresoraDeCaja({ sucursalId, impresoraCajaId, impresoras, enviar }: PropsCaja) {
  const clientes = useQueryClient();
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState('');
  const [fallo, setFallo] = useState('');

  const guardar = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (impresoraId: string | null) =>
      enviar((extra) => configurarImpresoraDeCaja(sucursalId, impresoraId, extra)),
  });

  async function elegir(valor: string) {
    if (eligiendo !== null) return;
    setConfirmacion('');
    setFallo('');
    setEligiendo(valor);
    try {
      const guardada = await guardar.mutateAsync(valor === NINGUNA ? null : valor);
      clientes.setQueryData<ImpresionSucursalRespuesta>(claveImpresoraDeCaja(sucursalId), guardada);
      const nueva = impresoras.find((i) => i.id === guardada.impresoraCajaId);
      setConfirmacion(
        nueva
          ? `La pre-cuenta sale ahora por ${nueva.nombre}.`
          : 'La pre-cuenta ya no se imprime: solo se ve en pantalla.',
      );
    } catch (error) {
      setFallo(falloDeDestino(error));
    } finally {
      setEligiendo(null);
      requestAnimationFrame(() => document.getElementById('impresora-de-caja')?.focus());
    }
  }

  const valor = eligiendo ?? impresoraCajaId ?? NINGUNA;
  const elegida = impresoras.find((i) => i.id === valor);

  return (
    <section className="impresion__bloque" aria-labelledby="impresion-caja">
      <div className="impresion__cabecera">
        <h3 className="formulario__titulo" id="impresion-caja">
          Impresora de caja
        </h3>
        <p className="texto-ayuda">
          Aquí sale la pre-cuenta cuando el mozo toca “Imprimir”. Sin impresora de caja, la
          pre-cuenta solo se ve en pantalla.
        </p>
      </div>
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos cambiar la impresora de caja">
          {fallo}
        </Aviso>
      ) : null}
      {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
      <div className="impresion__selectores">
        <CampoSeleccion
          id="impresora-de-caja"
          etiqueta="Impresora de la pre-cuenta"
          value={valor}
          disabled={eligiendo !== null}
          aria-busy={eligiendo !== null || undefined}
          onChange={(e) => void elegir(e.target.value)}
          ayuda={
            eligiendo !== null
              ? 'Guardando…'
              : elegida?.conexion.tipo === 'BLUETOOTH'
                ? AYUDA_DE_BLUETOOTH
                : undefined
          }
        >
          <option value={NINGUNA}>Ninguna</option>
          {opcionesDeImpresora(impresoras, impresoraCajaId ?? undefined).map((i) => (
            <option key={i.id} value={i.id}>
              {textoDeOpcion(i)}
            </option>
          ))}
        </CampoSeleccion>
      </div>
    </section>
  );
}
