import type { ComandaKds, EstacionKds } from '@restaurante/contratos';
import {
  Aviso,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoCocina,
  IconoImpresora,
  IconoInfo,
  IconoOk,
  Interruptor,
  Plegable,
  TarjetaKds,
  clases,
} from '@restaurante/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useConexion } from '../../lib/conexion';
import { useEstadoTiempoReal } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { resumenDeImpresion, useEstadoDeImpresion } from '../impresion/estado';
import { etiquetaDeMesas, pendientesEnOrden, recientesEnOrden } from './cocina';
import './cocina.css';
import {
  estacionesDelEquipo,
  guardarEstacionesDelEquipo,
  guardarSonidoDelEquipo,
  sonidoActivoEnElEquipo,
} from './preferencias';
import { motorDeSonido } from './sonido';
import { useAccionesDeCocina, useAhoraDeCocina, useCocina } from './useCocina';

/** Cuánto tiempo lleva la marca "Nueva" una comanda recién llegada. */
const MS_DE_MARCA_NUEVA = 12_000;

/** `/cocina`: las comandas de las estaciones que este equipo mira, en orden de llegada (criterios 56 a 62 y 96). */
export function CocinaPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Cocina" ancho="completo">
        <EstadoVacio icono={IconoCocina} titulo="Elige una sucursal">
          La cocina es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <CocinaDeSucursal
      key={sesion.sucursal.id}
      empresaId={sesion.empresaId}
      sucursalId={sesion.sucursal.id}
    />
  );
}

function CocinaDeSucursal({ empresaId, sucursalId }: { empresaId: string; sucursalId: string }) {
  const tiempoReal = useEstadoTiempoReal();
  const motor = motorDeSonido();

  // --- Filtros de estación, recordados en este equipo ------------------------------------------------
  const [elegidas, setElegidas] = useState<string[]>(() =>
    estacionesDelEquipo(empresaId, sucursalId),
  );
  // La lista de estaciones sale de la misma respuesta de la cocina: todas las activas, aunque el filtro pida
  // solo algunas, cada una con su destino (criterio 138). Al cambiar el filtro la consulta es otra y por un
  // momento no hay respuesta: se conserva la última lista para que los filtros no desaparezcan.
  const [estacionesVistas, setEstacionesVistas] = useState<readonly EstacionKds[] | undefined>(
    undefined,
  );
  // Solo las que salen por esta pantalla son filtros (criterio 138): las de impresora no tienen nada que
  // mostrar aquí, y filtrar por ellas dejaría la pantalla vacía.
  const filtrables = useMemo(
    () => estacionesVistas?.filter((e) => e.destino === 'KDS') ?? [],
    [estacionesVistas],
  );
  const porImpresora = useMemo(
    () => estacionesVistas?.filter((e) => e.destino === 'IMPRESORA') ?? [],
    [estacionesVistas],
  );
  // Una estación recordada que ya no sirve de filtro (otra sucursal, desactivada o ahora por impresora) se
  // ignora; la elección guardada en el equipo no se toca.
  const efectivas = useMemo(
    () =>
      estacionesVistas ? elegidas.filter((id) => filtrables.some((e) => e.id === id)) : elegidas,
    [elegidas, estacionesVistas, filtrables],
  );

  const consulta = useCocina(sucursalId, efectivas);
  const datos = consulta.data;
  const cocina = datos?.cocina;
  const estacionesDeLaRespuesta = cocina?.estaciones;
  useEffect(() => {
    if (estacionesDeLaRespuesta) setEstacionesVistas(estacionesDeLaRespuesta);
  }, [estacionesDeLaRespuesta]);
  const ahora = useAhoraDeCocina(datos);
  const acciones = useAccionesDeCocina(sucursalId);

  function alternarEstacion(id: string) {
    const siguiente = efectivas.includes(id)
      ? efectivas.filter((e) => e !== id)
      : [...efectivas, id];
    // Elegirlas todas es lo mismo que no filtrar.
    const lista = siguiente.length === filtrables.length ? [] : siguiente;
    setElegidas(lista);
    guardarEstacionesDelEquipo(empresaId, sucursalId, lista);
  }
  function verTodas() {
    setElegidas([]);
    guardarEstacionesDelEquipo(empresaId, sucursalId, []);
  }

  // --- Sonido ----------------------------------------------------------------------------------------
  const [sonidoActivo, setSonidoActivo] = useState(sonidoActivoEnElEquipo);
  const [sonidoListo, setSonidoListo] = useState(() => motor.listo());
  const sonidoActivoRef = useRef(sonidoActivo);
  sonidoActivoRef.current = sonidoActivo;

  function despertarSonido() {
    if (!sonidoListo) setSonidoListo(motor.desbloquear());
  }
  function cambiarSonido(activo: boolean) {
    setSonidoActivo(activo);
    guardarSonidoDelEquipo(activo);
    if (activo) {
      // El toque es el gesto que el navegador exige: se despierta el audio y suena una vez, para comprobarlo.
      setSonidoListo(motor.desbloquear());
      motor.avisar();
    }
  }

  // --- Comandas nuevas: marca visible y sonido ---------------------------------------------------------
  const [nuevas, setNuevas] = useState<ReadonlySet<string>>(() => new Set());
  const conocidas = useRef<{ filtro: string; ids: Set<string> } | null>(null);
  const marcas = useRef(new Set<ReturnType<typeof setTimeout>>());
  const filtro = efectivas.join(',');
  useEffect(() => {
    if (!cocina) return;
    const ids = [...cocina.pendientes, ...cocina.recientes].map((c) => c.id);
    // La primera lectura de un filtro no avisa: lo que ya estaba no es nuevo.
    if (conocidas.current?.filtro !== filtro) {
      conocidas.current = { filtro, ids: new Set(ids) };
      return;
    }
    const vistas = conocidas.current.ids;
    const llegadas = cocina.pendientes.filter((c) => !vistas.has(c.id)).map((c) => c.id);
    ids.forEach((id) => vistas.add(id));
    if (llegadas.length === 0) return;
    setNuevas((previas) => new Set([...previas, ...llegadas]));
    if (sonidoActivoRef.current) motor.avisar();
    const marca = setTimeout(() => {
      marcas.current.delete(marca);
      setNuevas((previas) => {
        const resto = new Set(previas);
        llegadas.forEach((id) => resto.delete(id));
        return resto;
      });
    }, MS_DE_MARCA_NUEVA);
    marcas.current.add(marca);
  }, [cocina, filtro, motor]);
  useEffect(() => {
    const pendientes = marcas.current;
    return () => pendientes.forEach((m) => clearTimeout(m));
  }, []);

  // --- Qué se ve -------------------------------------------------------------------------------------
  const [recientesAbiertas, setRecientesAbiertas] = useState(false);
  const pendientes = useMemo(() => pendientesEnOrden(cocina?.pendientes ?? []), [cocina]);
  const recientes = useMemo(() => recientesEnOrden(cocina?.recientes ?? []), [cocina]);

  function tarjeta(c: ComandaKds, modo: 'pendiente' | 'reciente') {
    const mesa = etiquetaDeMesas(c.orden.mesas);
    return (
      <li key={c.id}>
        <TarjetaKds
          tipo={c.tipo}
          mesa={mesa}
          mozo={c.orden.mozo.nombre}
          comensales={c.orden.comensales}
          estacion={c.estacion.nombre}
          creadaEn={c.creadaEn}
          ahora={ahora}
          motivo={c.motivo}
          lineas={c.lineas}
          modo={modo}
          nueva={modo === 'pendiente' && nuevas.has(c.id)}
          esperandoRed={acciones.esperando[c.id] !== undefined}
          alCambiarEstado={(linea, estado) =>
            acciones.cambiarEstado(c.id, linea.id, linea.nombre, estado)
          }
          alTodoListo={() => acciones.todoListo(c.id, mesa)}
          alEnterado={() => acciones.enterado(c.id, mesa)}
        />
      </li>
    );
  }

  return (
    <Pagina titulo="Cocina" ancho="completo">
      <div
        className="cocina"
        onPointerDownCapture={despertarSonido}
        onKeyDownCapture={despertarSonido}
      >
        <div className="cocina__herramientas">
          {filtrables.length > 1 ? (
            <div className="ui-segmentos cocina__filtros" role="group" aria-label="Estaciones">
              <FiltroDeEstacion
                etiqueta="Todas"
                elegido={efectivas.length === 0}
                onClick={verTodas}
              />
              {filtrables.map((e) => (
                <FiltroDeEstacion
                  key={e.id}
                  etiqueta={e.nombre}
                  elegido={efectivas.includes(e.id)}
                  onClick={() => alternarEstacion(e.id)}
                />
              ))}
            </div>
          ) : null}
          <div className="cocina__estado">
            <p className="cocina__resumen" role="status">
              {cocina
                ? pendientes.length === 0
                  ? 'Sin comandas pendientes'
                  : `${pendientes.length} ${pendientes.length === 1 ? 'pendiente' : 'pendientes'}`
                : ' '}
            </p>
            <div className="cocina__sonido">
              <Interruptor
                etiqueta="Sonido"
                marcado={sonidoActivo}
                onCambio={cambiarSonido}
                ayuda={
                  sonidoActivo && !sonidoListo
                    ? 'Toca la pantalla una vez para activar el sonido.'
                    : sonidoActivo
                      ? 'Suena al llegar una comanda.'
                      : 'Silenciado en este equipo.'
                }
              />
            </div>
          </div>
          <EstadoDeImpresion sucursalId={sucursalId} />
          {porImpresora.length > 0 ? (
            <ul className="cocina__destinos" aria-label="Estaciones que salen por impresora">
              {porImpresora.map((e) => (
                <li key={e.id} className="ui-campo__ayuda">
                  <Icono icono={IconoImpresora} tamano={16} />
                  {`${e.nombre} sale por la impresora ${e.impresora?.nombre ?? ''}`.trim()}
                  {' y no aparece en esta pantalla.'}
                </li>
              ))}
            </ul>
          ) : null}
          {tiempoReal === 'caido' ? (
            <p className="ui-campo__ayuda" role="status">
              Sin conexión en vivo. La cocina se actualiza cada 30 segundos.
            </p>
          ) : null}
        </div>

        <AvisoPendiente pendiente={acciones.pendiente} />
        {acciones.fallo ? (
          <Aviso tipo="error" titulo="No se pudo guardar">
            {acciones.fallo}
          </Aviso>
        ) : null}

        {datos === undefined && consulta.isPending ? (
          <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando las comandas" />
        ) : null}
        {datos === undefined && consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar las comandas"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : null}
        {datos !== undefined && consulta.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar la cocina">
            Lo que ves puede estar desactualizado. Seguimos intentando.
          </Aviso>
        ) : null}

        {cocina && pendientes.length === 0 ? (
          <EstadoVacio icono={IconoCocina} titulo="No hay comandas pendientes">
            Cuando llegue una comanda aparecerá aquí{sonidoActivo ? ' y sonará' : ''}.
          </EstadoVacio>
        ) : null}
        {pendientes.length > 0 ? (
          <ul className="cocina__tarjetas" aria-label="Comandas pendientes">
            {pendientes.map((c) => tarjeta(c, 'pendiente'))}
          </ul>
        ) : null}

        {cocina ? (
          <Plegable
            titulo="Recientes"
            resumen={
              recientes.length === 0
                ? 'Nada en la última hora'
                : `${recientes.length} ${recientes.length === 1 ? 'comanda' : 'comandas'} de la última hora`
            }
            abierto={recientesAbiertas}
            onCambio={setRecientesAbiertas}
          >
            {recientes.length === 0 ? (
              <p className="ui-campo__ayuda">
                Aquí quedan las comandas terminadas para corregir un «Listo» puesto por error.
              </p>
            ) : (
              <ul
                className={clases('cocina__tarjetas', 'cocina__tarjetas--recientes')}
                aria-label="Comandas recientes"
              >
                {recientes.map((c) => tarjeta(c, 'reciente'))}
              </ul>
            )}
          </Plegable>
        ) : null}
      </div>
    </Pagina>
  );
}

/**
 * El estado de la impresión, discreto, en la cabecera del KDS (criterio 138): una etiqueta de una línea con
 * palabras. Sale aquí aunque todo vaya bien, porque una estación que sale por impresora no aparece en esta
 * pantalla. El detalle de un problema está en el banner de arriba. Sin impresoras en la sucursal, no sale.
 */
function EstadoDeImpresion({ sucursalId }: { sucursalId: string }) {
  const { estado, desdeLaRespuestaMs } = useEstadoDeImpresion(sucursalId);
  const { sinConexion } = useConexion();
  const resumen = estado && !sinConexion ? resumenDeImpresion(estado, desdeLaRespuestaMs) : null;
  if (!resumen) return null;
  return (
    <p className="cocina__impresion">
      <EtiquetaDeEstado
        tono={resumen.tono}
        icono={
          resumen.tono === 'ok' ? IconoOk : resumen.tono === 'alerta' ? IconoImpresora : IconoInfo
        }
      >
        {resumen.texto}
      </EtiquetaDeEstado>
    </p>
  );
}

/** Filtro de estación: baldosa de 48 px con marca y `aria-pressed` cuando está elegido (varias a la vez). */
function FiltroDeEstacion({
  etiqueta,
  elegido,
  onClick,
}: {
  etiqueta: string;
  elegido: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clases('ui-segmento', elegido && 'ui-segmento--elegido')}
      aria-pressed={elegido}
      onClick={onClick}
    >
      {elegido ? <Icono icono={IconoOk} tamano={16} /> : null}
      {etiqueta}
    </button>
  );
}
