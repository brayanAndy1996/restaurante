import type { OrdenRespuesta, SalonRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  CuadriculaDeMesas,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoOk,
  IconoSalon,
  Interruptor,
  ListaDeFilas,
  Segmentos,
  claseFila,
  nombreAccesibleDeMesa,
} from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { preferenciaDelSalon, type VistaDelSalon } from '../../lib/almacen';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { useAnchoDe } from '../../lib/medidas';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { estaAbierta, tituloDeMesas } from './ordenes';
import {
  MAXIMO_MESAS_A_UNIR,
  cuantasSeEligen,
  cuentasQueSeAbsorben,
  fraseDeMovimiento,
  fraseDeUnion,
  listaDeNombres,
  mesasDeSeleccion,
  mesasPorId,
  moverCuenta,
  motivoNoElegible,
  resumenDeMesaElegida,
  unirMesas,
  type ModoDeSeleccion,
} from './mover-unir';
import {
  TEXTO_DE_ESTADO,
  TONO_DE_ESTADO,
  ayudaDeFila,
  cabeElMapa,
  ladoDeCelda,
  mesasEnOrdenDeLectura,
  rutaDeOrden,
  totalDeMesa,
} from './salon';
import { useAhoraDelSalon, useSalon } from './useSalon';
import type { SalonEnCache } from './salon';
import { useOrden } from './useOrden';
import './seleccion.css';

type ZonaDelSalon = SalonRespuesta['zonas'][number];

const MENSAJES = {
  MESA_OCUPADA:
    'Esa mesa acaba de ocuparse. Elige otra libre, o usa «Unir» para juntar las cuentas.',
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta. Actualizamos la pantalla.',
  NO_ENCONTRADO: 'Una de las mesas ya no existe. Actualizamos el salón.',
  CONFLICTO: 'Otra persona está cambiando estas mesas a la vez. Vuelve a intentarlo.',
  PROHIBIDO: 'Tu rol no puede mover ni unir mesas.',
  REFERENCIA_INVALIDA: 'Una de las mesas ya no es de esta cuenta. Actualizamos la pantalla.',
  DATOS_INVALIDOS: 'Una cuenta no puede tener más de 20 mesas. Elige menos mesas.',
} as const;

export const MoverCuentaPagina = () => <SeleccionDeMesasPagina modo="mover" />;
export const UnirMesasPagina = () => <SeleccionDeMesasPagina modo="unir" />;

/** `/salon/ordenes/:id/mover` y `/unir`: el mapa en modo selección (criterios 45 a 49 y 94 de 004). */
function SeleccionDeMesasPagina({ modo }: { modo: ModoDeSeleccion }) {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  const permiso = usePermiso('MOVER_UNIR_MESAS');
  const atras = { a: rutaDeOrden(id), etiqueta: 'Cuenta' };
  const titulo = modo === 'mover' ? 'Mover la cuenta' : 'Unir mesas';
  if (!sesion.sucursal) {
    return (
      <Pagina titulo={titulo} atras={atras}>
        <EstadoVacio icono={IconoSalon} titulo="Elige una sucursal">
          Las mesas son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  if (permiso === 'prohibido') {
    return (
      <Pagina titulo={titulo} atras={atras}>
        <EstadoVacio icono={IconoSalon} titulo="Tu rol no mueve ni une mesas">
          Pide a un mozo, cajero o supervisor que lo haga.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Seleccion
      key={`${modo}.${id}.${sesion.usuario?.id ?? 'soporte'}.${sesion.sucursal.id}`}
      modo={modo}
      ordenId={id}
      empresaId={sesion.empresaId}
      sucursalId={sesion.sucursal.id}
    />
  );
}

function Seleccion({
  modo,
  ordenId,
  empresaId,
  sucursalId,
}: {
  modo: ModoDeSeleccion;
  ordenId: string;
  empresaId: string;
  sucursalId: string;
}) {
  const consultaOrden = useOrden(ordenId);
  const consultaSalon = useSalon(sucursalId);
  const orden = consultaOrden.data?.orden;
  const datos = consultaSalon.data;
  const titulo = modo === 'mover' ? 'Mover la cuenta' : 'Unir mesas';
  const atras = { a: rutaDeOrden(ordenId), etiqueta: 'Cuenta' };

  if (
    !orden &&
    consultaOrden.error instanceof ErrorApi &&
    consultaOrden.error.codigo === 'NO_ENCONTRADO'
  ) {
    return (
      <Pagina titulo={titulo} atras={atras}>
        <EstadoVacio icono={IconoSalon} titulo="Esta cuenta no existe">
          Puede que se haya anulado o que no sea de esta sucursal. Vuelve al salón.
        </EstadoVacio>
      </Pagina>
    );
  }
  if (!orden || !datos) {
    return (
      <Pagina titulo={titulo} atras={atras}>
        {consultaOrden.isError || consultaSalon.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar las mesas"
            onReintentar={() => {
              void consultaOrden.refetch();
              void consultaSalon.refetch();
            }}
            reintentando={consultaOrden.isFetching || consultaSalon.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : (
          <EsqueletoDeLista filas={4} conInicial={false} etiqueta="Cargando las mesas" />
        )}
      </Pagina>
    );
  }
  if (!estaAbierta(orden)) {
    return (
      <Pagina titulo={titulo} atras={atras}>
        <EstadoVacio icono={IconoSalon} titulo="Esta cuenta ya no está abierta">
          No se puede {modo === 'mover' ? 'mover' : 'unir'} una cuenta que ya no está abierta.{' '}
          <Link to={rutaDeOrden(ordenId)}>Volver a la cuenta</Link>
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <ElegirMesas
      modo={modo}
      orden={orden}
      datos={datos}
      salonDesactualizado={consultaSalon.isError}
      empresaId={empresaId}
      sucursalId={sucursalId}
    />
  );
}

/** La selección ya con la cuenta y el salón a la vista: el contenedor existe desde el primer dibujo y se puede medir. */
function ElegirMesas({
  modo,
  orden,
  datos,
  salonDesactualizado,
  empresaId,
  sucursalId,
}: {
  modo: ModoDeSeleccion;
  orden: OrdenRespuesta;
  datos: SalonEnCache;
  salonDesactualizado: boolean;
  empresaId: string;
  sucursalId: string;
}) {
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const ordenId = orden.id;
  const ahora = useAhoraDelSalon(datos);

  const marco = useRef<HTMLDivElement>(null);
  const ancho = useAnchoDe(marco);
  const [zonaElegida, setZonaElegida] = useState<string | null>(null);
  const [vistaElegida, setVistaElegida] = useState<VistaDelSalon | null>(
    () => preferenciaDelSalon(empresaId, sucursalId).vista,
  );
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [origenId, setOrigenId] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  // Un nuevo toque tras un fallo repite la misma clave de idempotencia si nada cambió.
  const intento = useRef<{ huella: string; clave: string } | null>(null);

  const zonas = datos.salon.zonas;
  const titulo = modo === 'mover' ? 'Mover la cuenta' : 'Unir mesas';
  const atras = { a: rutaDeOrden(ordenId), etiqueta: 'Cuenta' };

  const mesasDeLaCuenta = new Set(orden.mesas.map((m) => m.id));
  const porId = mesasPorId(zonas);
  const variasMesas = orden.mesas.length > 1;
  const nombreDeLaCuenta = tituloDeMesas(orden.mesas).toLowerCase();

  // Lo elegido que sigue siendo elegible (otra persona pudo ocupar la mesa mientras se decidía).
  const vigentes = elegidas.filter((id) => {
    const e = porId.get(id);
    return e !== undefined && motivoNoElegible(modo, e.mesa, mesasDeLaCuenta) === null;
  });
  const perdidas = elegidas.filter((id) => !vigentes.includes(id));
  const mesasElegidas = vigentes.flatMap((id) => {
    const e = porId.get(id);
    return e ? [e.mesa] : [];
  });
  const origen = variasMesas ? (orden.mesas.find((m) => m.id === origenId) ?? null) : null;
  const origenNombre = origen?.nombre ?? orden.mesas[0]?.nombre ?? '';

  // La zona donde está la cuenta es la que se ve primero; después, la que la persona elige.
  const zonaDeLaCuenta = zonas.find((z) => z.mesas.some((m) => mesasDeLaCuenta.has(m.id)));
  const zona: ZonaDelSalon | undefined =
    zonas.find((z) => z.id === zonaElegida) ?? zonaDeLaCuenta ?? zonas[0];
  const sinMesas = zona === undefined || zona.mesas.length === 0;
  const vista: VistaDelSalon =
    vistaElegida ?? (zona && !cabeElMapa(ancho, zona.columnas) ? 'lista' : 'mapa');
  const hayDondeElegir = zonas.some((z) => cuantasSeEligen(z, modo, mesasDeLaCuenta) > 0);

  function tocarMesa(id: string) {
    setFallo(null);
    if (modo === 'mover') {
      setElegidas([id]);
      return;
    }
    setElegidas((actuales) => {
      const sinPerdidas = actuales.filter((a) => vigentes.includes(a));
      if (sinPerdidas.includes(id)) return sinPerdidas.filter((a) => a !== id);
      return sinPerdidas.length >= MAXIMO_MESAS_A_UNIR ? sinPerdidas : [...sinPerdidas, id];
    });
  }

  const faltaOrigen = modo === 'mover' && variasMesas && origen === null;
  const destino = mesasElegidas[0];
  const listoParaConfirmar =
    modo === 'mover' ? destino !== undefined && !faltaOrigen : mesasElegidas.length > 0;
  const nombresElegidos = mesasElegidas.map((m) => m.nombre);
  const absorbidas = modo === 'unir' ? cuentasQueSeAbsorben(mesasElegidas) : [];

  const etiquetaDelBoton = !listoParaConfirmar
    ? faltaOrigen && destino !== undefined
      ? 'Elige la mesa que mueves'
      : modo === 'mover'
        ? 'Elige una mesa libre'
        : 'Elige las mesas a unir'
    : modo === 'mover'
      ? `Mover a la ${nombreAccesibleDeMesa(destino?.nombre ?? '').toLowerCase()}`
      : `Unir ${listaDeNombres(nombresElegidos)}`;

  async function confirmar() {
    if (enviando || !listoParaConfirmar) return;
    setEnviando(true);
    setFallo(null);
    const huella =
      modo === 'mover'
        ? `mover|${origen?.id ?? ''}|${destino?.id ?? ''}`
        : `unir|${[...vigentes].sort().join(',')}`;
    if (intento.current?.huella !== huella) {
      intento.current = { huella, clave: nuevaClaveDeIdempotencia() };
    }
    const clave = intento.current.clave;
    try {
      if (modo === 'mover' && destino) {
        await envio.enviar(
          (extra) =>
            moverCuenta(
              ordenId,
              { mesaDestinoId: destino.id, ...(origen ? { mesaOrigenId: origen.id } : {}) },
              extra,
            ),
          undefined,
          undefined,
          clave,
        );
      } else {
        await envio.enviar(
          (extra) => unirMesas(ordenId, { mesaIds: [...vigentes] }, extra),
          undefined,
          undefined,
          clave,
        );
      }
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.ordenes });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      const hecho =
        modo === 'mover'
          ? `La cuenta pasó a la ${nombreAccesibleDeMesa(destino?.nombre ?? '').toLowerCase()}. La ${nombreAccesibleDeMesa(origenNombre).toLowerCase()} quedó libre.`
          : `Se unieron ${listaDeNombres(nombresElegidos)} a esta cuenta. La venta queda a nombre de ${orden?.mozo.nombre ?? ''}.`;
      navegar(rutaDeOrden(ordenId), { replace: true, state: { hecho } });
    } catch (error) {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      if (!envio.sigueMontada()) return;
      setConfirmando(false);
      setFallo(mensajeDeError(error, MENSAJES));
      // Una mesa que ya no vale se suelta; el resto de la elección se conserva.
      if (error instanceof ErrorApi && error.codigo === 'MESA_OCUPADA') setElegidas([]);
    } finally {
      if (envio.sigueMontada()) setEnviando(false);
    }
  }

  const pie = (
    <Boton
      variante="principal"
      bloque
      disabled={!listoParaConfirmar}
      onClick={() => {
        setFallo(null);
        setConfirmando(true);
      }}
    >
      {etiquetaDelBoton}
    </Boton>
  );

  return (
    <Pagina titulo={titulo} atras={atras} ancho="ancho" pie={pie}>
      <div className="seleccion" ref={marco}>
        <div className="seleccion__cargo">
          <p className="seleccion__instruccion">
            {modo === 'mover'
              ? `Toca la mesa libre a la que pasa la cuenta de la ${nombreDeLaCuenta}.`
              : `Toca las mesas que se suman a la cuenta de la ${nombreDeLaCuenta}. Pueden estar libres u ocupadas.`}
          </p>
          <p className="seleccion__mozo">
            {modo === 'mover' ? 'Sigue a cargo de ' : 'La venta queda a nombre de '}
            <b>{orden.mozo.nombre}</b>
            {modo === 'unir' ? ', el mozo de esta cuenta' : ''}.
          </p>
        </div>

        {modo === 'mover' && variasMesas ? (
          <Segmentos
            etiqueta="Mesa que se mueve"
            opciones={orden.mesas.map((m) => ({
              valor: m.id,
              etiqueta: nombreAccesibleDeMesa(m.nombre),
            }))}
            valor={origenId}
            onCambio={setOrigenId}
          />
        ) : null}

        {salonDesactualizado ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar el salón">
            Lo que ves puede estar desactualizado. Seguimos intentando.
          </Aviso>
        ) : null}
        {perdidas.length > 0 ? (
          <Aviso tipo="alerta" titulo="Ya no se puede elegir">
            Otra persona cambió{' '}
            {listaDeNombres(
              perdidas.map((id) => nombreAccesibleDeMesa(porId.get(id)?.mesa.nombre ?? '')),
            )}
            . Elige otra mesa.
          </Aviso>
        ) : null}
        {fallo ? (
          <Aviso tipo="error" titulo={modo === 'mover' ? 'No pudimos mover' : 'No pudimos unir'}>
            {fallo}
          </Aviso>
        ) : null}
        {!hayDondeElegir ? (
          <Aviso
            tipo="info"
            titulo={modo === 'mover' ? 'No hay mesas libres' : 'No hay otras mesas'}
          >
            {modo === 'mover'
              ? 'Cuando una mesa se libere podrás pasar la cuenta. Para juntar cuentas, usa «Unir».'
              : 'Esta cuenta ya tiene todas las mesas del salón.'}
          </Aviso>
        ) : null}

        {zona && zonas.length > 1 ? (
          <Segmentos
            etiqueta="Zonas del salón"
            opciones={zonas.map((z) => ({ valor: z.id, etiqueta: z.nombre }))}
            valor={zona.id}
            onCambio={setZonaElegida}
          />
        ) : null}

        {zona && !sinMesas ? (
          <>
            <div className="seleccion__barra">
              <Interruptor
                etiqueta="Lista"
                marcado={vista === 'lista'}
                onCambio={(marcado) => setVistaElegida(marcado ? 'lista' : 'mapa')}
              />
            </div>
            {vista === 'mapa' ? (
              <CuadriculaDeMesas
                etiqueta={`Mesas de ${zona.nombre}`}
                columnas={zona.columnas}
                filas={zona.filas}
                mesas={mesasDeSeleccion(zona, ahora, modo, mesasDeLaCuenta)}
                tamanoCelda={ladoDeCelda(ancho, zona.columnas)}
                mesasElegidasIds={vigentes}
                onElegirMesa={tocarMesa}
              />
            ) : (
              <ListaDeSeleccion
                zona={zona}
                ahora={ahora}
                modo={modo}
                mesasDeLaCuenta={mesasDeLaCuenta}
                elegidas={vigentes}
                onTocar={tocarMesa}
              />
            )}
          </>
        ) : zona ? (
          <EstadoVacio icono={IconoSalon} titulo="Esta zona aún no tiene mesas">
            Elige otra zona.
          </EstadoVacio>
        ) : null}

        {modo === 'unir' && mesasElegidas.length > 0 ? (
          <section className="seleccion__elegidas" aria-label="Mesas elegidas">
            <h2 className="seleccion__titulo">Se unen a esta cuenta ({mesasElegidas.length})</h2>
            <ul>
              {mesasElegidas.map((mesa) => (
                <li key={mesa.id}>
                  <span>{resumenDeMesaElegida(mesa)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <DialogoConfirmacion
        abierta={confirmando}
        titulo={
          modo === 'mover'
            ? `¿Mover a la ${nombreAccesibleDeMesa(destino?.nombre ?? '').toLowerCase()}?`
            : `¿Unir ${listaDeNombres(nombresElegidos)}?`
        }
        etiquetaConfirmar={modo === 'mover' ? 'Sí, mover' : 'Sí, unir'}
        cargando={enviando}
        textoCargando={
          envio.pendiente ? 'Pendiente de envío' : modo === 'mover' ? 'Moviendo…' : 'Uniendo…'
        }
        error={<AvisoPendiente pendiente={envio.pendiente} />}
        onConfirmar={() => void confirmar()}
        onCancelar={() => {
          if (!enviando) setConfirmando(false);
        }}
      >
        <div className="seleccion__confirmacion">
          <p>
            {modo === 'mover'
              ? fraseDeMovimiento(origenNombre, destino?.nombre ?? '', orden)
              : fraseDeUnion(mesasElegidas, orden)}
          </p>
          {modo === 'mover' ? (
            <p>Los ítems y la pre-cuenta no cambian.</p>
          ) : (
            <ConfirmacionDeUnion absorbidas={absorbidas} orden={orden} />
          )}
        </div>
      </DialogoConfirmacion>
    </Pagina>
  );
}

function ConfirmacionDeUnion({
  absorbidas,
  orden,
}: {
  absorbidas: ReturnType<typeof cuentasQueSeAbsorben>;
  orden: OrdenRespuesta;
}) {
  if (absorbidas.length === 0) return <p>Las mesas libres pasan a compartir esta cuenta.</p>;
  return (
    <>
      <p>Estas cuentas se juntan con la tuya; sus ítems y comensales se suman:</p>
      <ul className="seleccion__absorbidas">
        {absorbidas.map((c) => (
          <li key={c.ordenId}>
            <b>{listaDeNombres(c.mesas.map((n) => nombreAccesibleDeMesa(n)))}</b>
            <span>
              cuenta de {c.mozo}
              {c.total ? ` · ${c.total}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {absorbidas.some((c) => c.enPrecuenta) ? (
        <p>La pre-cuenta de la otra cuenta deja de valer.</p>
      ) : null}
      {orden.estado === 'EN_PRECUENTA' ? (
        <p>Si traen ítems, la pre-cuenta de esta cuenta deja de valer y se pide otra.</p>
      ) : null}
    </>
  );
}

function ListaDeSeleccion({
  zona,
  ahora,
  modo,
  mesasDeLaCuenta,
  elegidas,
  onTocar,
}: {
  zona: ZonaDelSalon;
  ahora: number;
  modo: ModoDeSeleccion;
  mesasDeLaCuenta: ReadonlySet<string>;
  elegidas: readonly string[];
  onTocar: (id: string) => void;
}) {
  return (
    <ListaDeFilas etiqueta={`Mesas de ${zona.nombre}`}>
      {mesasEnOrdenDeLectura(zona).map((mesa) => {
        const motivo = motivoNoElegible(modo, mesa, mesasDeLaCuenta);
        const elegida = elegidas.includes(mesa.id);
        const total = totalDeMesa(mesa);
        const nombre = nombreAccesibleDeMesa(mesa.nombre);
        return (
          <li key={mesa.id}>
            <button
              type="button"
              className={claseFila(motivo !== null)}
              aria-pressed={motivo === null ? elegida : undefined}
              disabled={motivo !== null}
              aria-label={[
                nombre,
                ayudaDeFila(mesa, ahora),
                TEXTO_DE_ESTADO[mesa.estado],
                total,
                motivo,
                elegida ? 'elegida' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              onClick={() => onTocar(mesa.id)}
            >
              <ContenidoDeFila
                titulo={nombre}
                ayuda={motivo ? `No se puede: ${motivo}` : ayudaDeFila(mesa, ahora)}
                derecha={
                  <span className="seleccion__fila-estado">
                    <EtiquetaDeEstado tono={TONO_DE_ESTADO[mesa.estado]}>
                      {TEXTO_DE_ESTADO[mesa.estado]}
                    </EtiquetaDeEstado>
                    {total ? <span className="seleccion__fila-total">{total}</span> : null}
                    {elegida ? (
                      <span className="seleccion__marca">
                        <Icono icono={IconoOk} tamano={16} /> Elegida
                      </span>
                    ) : null}
                  </span>
                }
              />
            </button>
          </li>
        );
      })}
    </ListaDeFilas>
  );
}
