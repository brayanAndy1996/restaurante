import type { ProductoDeVenta } from '@restaurante/contratos';
import type { HastaAgotado } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoTexto,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Hoja,
  IconoAlerta,
  IconoBuscar,
  IconoDisponibilidad,
  IconoError,
  IconoInfo,
  IconoReloj,
  Interruptor,
  OpcionesConAyuda,
  Segmentos,
  TablaResponsiva,
  claseBoton,
  type OpcionConAyuda,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EtiquetaPendiente } from '../../componentes/PendienteDeEnvio';
import { estacionGuardada, guardarEstacion } from '../../lib/almacen';
import { ahoraDelServidor } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { identidadActual } from '../../lib/identidad';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { horaDeLima } from '../../lib/formato';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import {
  afectadosPorAgotar,
  ayudaDeFila,
  cercaDelCorte,
  conAgotadoConfirmado,
  contar,
  etiquetaDeAgotado,
  filtrarFamilias,
  minutosParaElCorte,
  motivoEnPalabras,
  textoDeMinutos,
  vistaConIntenciones,
  type Intencion,
} from './agotados';
import {
  CLAVES_DISPONIBILIDAD,
  consultarSucursal,
  marcarAgotado,
  reactivarAgotado,
  type SeccionDeDisponibilidad,
  type VistaEnCache,
} from './disponibilidad';
import { useVistaDeSucursal } from './useVistaDeSucursal';

/** Cuánto dura el aviso con "Deshacer" (criterio 77). */
const MS_PARA_DESHACER = 5000;
/** Más productos que esto y aparece la búsqueda. */
const PRODUCTOS_PARA_BUSCAR = 8;

interface PropsMarco {
  actual: SeccionDeDisponibilidad;
  pie?: ReactNode;
  children: ReactNode;
}

type Accion = { accion: 'marcar'; hasta: HastaAgotado } | { accion: 'reactivar' };

interface Deshacer {
  texto: string;
  deshacer: () => void;
}

/** La hora del servidor, que se actualiza cada medio minuto: alcanza para el aviso de la hora de corte. */
function useAhora(periodoMs = 30_000): Date {
  const [ahora, setAhora] = useState(() => new Date(ahoraDelServidor()));
  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date(ahoraDelServidor())), periodoMs);
    return () => clearInterval(reloj);
  }, [periodoMs]);
  return ahora;
}

/** Lo que falló al marcar o reactivar, con la salida. */
function falloDeAgotado(error: unknown): string {
  const codigo = error instanceof ErrorApi ? error.codigo : undefined;
  const detalle =
    codigo === 'NO_ENCONTRADO'
      ? 'Este producto ya no existe o no se ofrece en esta sucursal.'
      : mensajeDeError(error, {
          PROHIBIDO: 'No tienes permiso para marcar agotados en esta sucursal.',
          SUCURSAL_NO_ELEGIDA: 'Elige primero tu sucursal.',
        });
  return `${detalle} Lo dejamos como estaba.`;
}

/**
 * "Agotados" de Disponibilidad (003, criterios 39 a 54 y 77, 78 y 80): los productos de la carta de la
 * sucursal activa por familia, con filtro por estación (la última se recuerda en este equipo), búsqueda y
 * "Solo agotados". El interruptor "Agotado" marca (con una hoja: "Solo por hoy" o "Hasta que lo reactive") o
 * reactiva; el cambio se ve al instante, queda "Pendiente de envío" si no hay red y se puede deshacer
 * durante 5 segundos. Lo usa sobre todo Cocina/Barra, de pie y en el celular: botones grandes y estados
 * dichos con palabras.
 */
export function AgotadosSeccion({
  marco: Marco,
  actual,
}: {
  marco: ComponentType<PropsMarco>;
  actual: SeccionDeDisponibilidad;
}) {
  const sesion = useSesionActiva();
  const clientes = useQueryClient();
  const puedeEditarLaCarta = usePermiso('EDITAR_CARTA') === 'permitido';
  const sucursalId = sesion.sucursal?.id ?? '';
  const empresaId = sesion.empresaId;
  const { enviar } = useEnvioPendiente();
  const ahora = useAhora();

  const consulta = useVistaDeSucursal(sucursalId);
  const horaDeCorte = useQuery({
    queryKey: CLAVES_DISPONIBILIDAD.corte(sucursalId),
    queryFn: ({ signal }) => consultarSucursal(sucursalId, signal),
    enabled: sucursalId !== '',
    staleTime: 10 * 60_000,
    select: (sucursal) => sucursal.horaCorte,
  });
  // Es un dato de apoyo: si no llega, la hoja y el aviso hablan del "siguiente día" sin decir la hora.
  const corte = horaDeCorte.data ?? null;

  const [estacionElegida, setEstacionElegida] = useState<string | null>(() =>
    estacionGuardada(empresaId),
  );
  const [texto, setTexto] = useState('');
  const [soloAgotados, setSoloAgotados] = useState(false);
  const [intenciones, setIntenciones] = useState<Readonly<Record<string, Intencion>>>({});
  const [pendientes, setPendientes] = useState<Readonly<Record<string, number>>>({});
  const [fallos, setFallos] = useState<readonly string[]>([]);
  const [paraMarcar, setParaMarcar] = useState<ProductoDeVenta | null>(null);
  const [hastaElegido, setHastaElegido] = useState<HastaAgotado>('FIN_DEL_DIA');
  const [deshacer, setDeshacer] = useState<Deshacer | null>(null);
  const [pausado, setPausado] = useState(false);

  const version = useRef(0);
  // Un producto a la vez: marcar y deshacer enseguida no deben cruzarse en el camino (sin red, ambos esperan).
  const cadenas = useRef(new Map<string, Promise<unknown>>());

  const vista = consulta.data?.vista;
  const estaciones = useMemo(() => vista?.estaciones ?? [], [vista]);
  const nombresDeEstacion = useMemo(
    () => new Map(estaciones.map((e) => [e.id, e.nombre])),
    [estaciones],
  );
  const familias = useMemo(
    () => vistaConIntenciones(vista?.familias ?? [], intenciones),
    [vista, intenciones],
  );
  // Una estación recordada que ya no existe (otra empresa, estación desactivada) se ignora.
  const estacionId =
    estacionElegida !== null && estaciones.some((e) => e.id === estacionElegida)
      ? estacionElegida
      : null;
  const { productos: totalProductos, agotados: totalAgotados } = contar(familias, estacionId);
  const visibles = filtrarFamilias(familias, { estacionId, texto, soloAgotados });
  const mostrados = visibles.reduce((suma, f) => suma + f.productos.length, 0);

  // El aviso "Deshacer" se va solo a los 5 segundos, salvo que la persona lo tenga bajo el dedo o con el foco.
  useEffect(() => {
    if (!deshacer || pausado) return;
    const temporizador = setTimeout(() => setDeshacer(null), MS_PARA_DESHACER);
    return () => clearTimeout(temporizador);
  }, [deshacer, pausado]);

  function elegirEstacion(valor: string) {
    const siguiente = valor === 'todas' ? null : valor;
    setEstacionElegida(siguiente);
    guardarEstacion(empresaId, siguiente);
  }

  function ajustarPendiente(productoId: string, esperando: boolean) {
    setPendientes((previos) => {
      const cuenta = Math.max(0, (previos[productoId] ?? 0) + (esperando ? 1 : -1));
      const { [productoId]: _antes, ...resto } = previos;
      return cuenta === 0 ? resto : { ...resto, [productoId]: cuenta };
    });
  }

  function quitarIntencion(productoId: string, deVersion: number) {
    setIntenciones((previas) => {
      if (previas[productoId]?.version !== deVersion) return previas;
      const { [productoId]: _quitada, ...resto } = previas;
      return resto;
    });
  }

  function encolar<T>(productoId: string, tarea: () => Promise<T>): Promise<T> {
    const previa = cadenas.current.get(productoId) ?? Promise.resolve();
    const siguiente = previa.then(tarea, tarea);
    cadenas.current.set(productoId, siguiente);
    const limpiar = () => {
      if (cadenas.current.get(productoId) === siguiente) cadenas.current.delete(productoId);
    };
    siguiente.then(limpiar, limpiar);
    return siguiente;
  }

  /** Muestra el cambio al instante y lo manda; si falla por una razón de negocio, vuelve a como estaba. */
  function pedir(producto: ProductoDeVenta, accion: Accion) {
    const numero = (version.current += 1);
    const intencion: Intencion = {
      ...accion,
      version: numero,
      en: new Date(ahoraDelServidor()).toISOString(),
    };
    setIntenciones((previas) => ({ ...previas, [producto.id]: intencion }));
    setFallos([]);
    const clave = CLAVES_DISPONIBILIDAD.vista(sucursalId);
    // Quién lo pide y en qué sucursal se toma ahora, no cuando le toque el turno en la cadena: si la sesión
    // cambia mientras espera, este cambio no debe salir a nombre de otra persona ni en otra sucursal.
    const origen = identidadActual();
    const envio = encolar(producto.id, () =>
      enviar(
        (extra) =>
          accion.accion === 'marcar'
            ? marcarAgotado(producto.id, { hasta: accion.hasta }, extra)
            : reactivarAgotado(producto.id, extra).then(() => null),
        (esperando) => ajustarPendiente(producto.id, esperando),
        origen,
      ),
    );
    envio.then(
      (respuesta) => {
        // Lo confirmado pasa a la vista guardada (sin ETag: la próxima consulta la baja completa) y recién
        // entonces se quita lo provisional, para que la fila no parpadee.
        clientes.setQueryData<VistaEnCache>(clave, (previo) =>
          previo
            ? {
                ...previo,
                etag: null,
                vista: conAgotadoConfirmado(
                  previo.vista,
                  producto.id,
                  respuesta
                    ? { desde: respuesta.desde, hasta: respuesta.hasta, origen: respuesta.origen }
                    : null,
                ),
              }
            : previo,
        );
        quitarIntencion(producto.id, numero);
        void clientes.invalidateQueries({ queryKey: clave });
        // El menú del día dice qué platos no están disponibles: un agotado puede cambiarlo.
        void clientes.invalidateQueries({ queryKey: ['disponibilidad', 'menu'] });
      },
      (error: unknown) => {
        quitarIntencion(producto.id, numero);
        setFallos((previos) => [...previos, `${producto.nombre}: ${falloDeAgotado(error)}`]);
        void clientes.invalidateQueries({ queryKey: clave });
      },
    );
  }

  function marcar(producto: ProductoDeVenta, hasta: HastaAgotado) {
    pedir(producto, { accion: 'marcar', hasta });
    setPausado(false);
    setDeshacer({
      texto: `${producto.nombre} está agotado`,
      deshacer: () => pedir(producto, { accion: 'reactivar' }),
    });
  }

  function reactivar(producto: ProductoDeVenta) {
    const antes = producto.agotado;
    pedir(producto, { accion: 'reactivar' });
    setPausado(false);
    setDeshacer({
      texto: `${producto.nombre} vuelve a estar disponible`,
      deshacer: () => pedir(producto, { accion: 'marcar', hasta: antes?.hasta ?? 'FIN_DEL_DIA' }),
    });
  }

  function alCambiarInterruptor(producto: ProductoDeVenta, agotado: boolean) {
    if (agotado) {
      setHastaElegido('FIN_DEL_DIA');
      setParaMarcar(producto);
    } else {
      reactivar(producto);
    }
  }

  // --- Aviso de la hora de corte --------------------------------------------------------------------
  const soloPorHoy = familias
    .flatMap((f) => f.productos)
    .filter((p) => p.agotado?.hasta === 'FIN_DEL_DIA' && p.agotado.origen === 'MANUAL');
  const avisarCorte = corte !== null && soloPorHoy.length > 0 && cercaDelCorte(corte, ahora);

  const pie = deshacer ? (
    <div
      className="agotados__deshacer"
      role="status"
      onPointerEnter={() => setPausado(true)}
      onPointerLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span className="agotados__deshacer-texto">{deshacer.texto}</span>
      <Boton
        variante="texto"
        onClick={() => {
          deshacer.deshacer();
          setDeshacer(null);
        }}
      >
        Deshacer
      </Boton>
    </div>
  ) : undefined;

  const cargando = sucursalId !== '' && consulta.isPending;
  let contenido: ReactNode;
  if (sucursalId === '') {
    contenido = (
      <Aviso tipo="alerta" titulo="Elige primero tu sucursal">
        Los agotados se marcan por sucursal.{' '}
        <Link to="/sucursal" className="enlace-texto">
          Elegir sucursal
        </Link>
      </Aviso>
    );
  } else if (cargando) {
    contenido = <EsqueletoDeLista filas={6} conInicial={false} etiqueta="Cargando los productos" />;
  } else if (!vista) {
    contenido = (
      <ErrorDeCarga
        titulo={
          consulta.error instanceof ErrorApi && consulta.error.sinConexion
            ? 'Sin conexión'
            : 'No pudimos cargar los productos'
        }
        onReintentar={() => void consulta.refetch()}
        reintentando={consulta.isFetching}
      >
        {mensajeDeError(consulta.error, {
          SUCURSAL_NO_ELEGIDA: 'Elige primero tu sucursal.',
        })}
      </ErrorDeCarga>
    );
  } else if (vista.familias.length === 0) {
    contenido = (
      <EstadoVacio
        icono={IconoDisponibilidad}
        titulo="Esta sucursal no tiene productos en la carta"
        accion={
          puedeEditarLaCarta ? (
            <Link to="/carta" className={claseBoton('principal')}>
              Ir a la carta
            </Link>
          ) : undefined
        }
      >
        {puedeEditarLaCarta
          ? 'Agrega productos en la carta, o revisa que estén disponibles en esta sucursal.'
          : 'Pide al Administrador o a un Cajero que agregue productos a la carta de esta sucursal.'}
      </EstadoVacio>
    );
  } else {
    const hayEstaciones = estaciones.length > 1;
    const actualizada = consulta.data ? horaDeLima(new Date(consulta.data.actualizadaEn)) : null;
    contenido = (
      <>
        {consulta.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar la lista" icono={IconoAlerta}>
            Lo que ves puede estar desactualizado: es lo último que recibimos, a las {actualizada}.
            Seguimos intentando.
          </Aviso>
        ) : null}
        {avisarCorte && corte ? (
          <Aviso tipo="info" titulo={`A las ${corte} empieza otro día`} icono={IconoReloj}>
            Faltan {textoDeMinutos(minutosParaElCorte(corte, ahora))}.{' '}
            {soloPorHoy.length === 1
              ? `«${soloPorHoy[0]?.nombre}» volverá a estar disponible.`
              : `Los ${soloPorHoy.length} productos agotados solo por hoy volverán a estar disponibles.`}{' '}
            Si sigue agotado, márcalo de nuevo después de esa hora o elige «Hasta que lo reactive».
          </Aviso>
        ) : null}
        {fallos.length > 0 ? (
          <Aviso tipo="error" titulo="No pudimos guardar el cambio" icono={IconoError}>
            <ul className="carta__usos">
              {fallos.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Aviso>
        ) : null}

        <div className="agotados__filtros">
          {totalProductos > PRODUCTOS_PARA_BUSCAR || texto !== '' ? (
            <CampoTexto
              className="agotados__busqueda"
              etiqueta="Buscar"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nombre del producto"
              autoComplete="off"
            />
          ) : null}
          {hayEstaciones ? (
            <Segmentos
              etiqueta="Estación"
              opciones={[
                { valor: 'todas', etiqueta: 'Todas' },
                ...estaciones.map((e) => ({ valor: e.id, etiqueta: e.nombre })),
              ]}
              valor={estacionId ?? 'todas'}
              onCambio={elegirEstacion}
            />
          ) : null}
          <div className="agotados__que-ver">
            <Segmentos
              etiqueta="Qué mostrar"
              opciones={[
                { valor: 'todos', etiqueta: 'Todos' },
                { valor: 'agotados', etiqueta: 'Solo agotados' },
              ]}
              valor={soloAgotados ? 'agotados' : 'todos'}
              onCambio={(valor) => setSoloAgotados(valor === 'agotados')}
            />
          </div>
        </div>

        <div className="agotados__resumen">
          <p className="texto-ayuda" role="status">
            {mostrados === totalProductos
              ? plural(mostrados, 'producto', 'productos')
              : `${mostrados} de ${plural(totalProductos, 'producto', 'productos')}`}
            {' · '}
            {plural(totalAgotados, 'agotado', 'agotados')}
          </p>
          {actualizada ? <p className="texto-ayuda">Actualizado a las {actualizada}</p> : null}
        </div>

        {visibles.length === 0 ? (
          <SinResultados
            soloAgotados={soloAgotados}
            hayTexto={texto.trim() !== ''}
            alVerTodos={() => setSoloAgotados(false)}
          />
        ) : (
          visibles.map((familia) => (
            <section
              key={familia.id}
              className="carta__familia agotados__familia"
              aria-label={familia.nombre}
            >
              <div className="carta__familia-encabezado">
                <h2 className="formulario__titulo">{familia.nombre}</h2>
              </div>
              <TablaResponsiva
                etiqueta={`Productos de ${familia.nombre}`}
                filas={familia.productos}
                clave={(p) => p.id}
                filaEnLista={(p) => (
                  <div
                    className={
                      p.agotado
                        ? 'ui-fila agotados__fila agotados__fila--agotada'
                        : 'ui-fila agotados__fila'
                    }
                  >
                    <span className="ui-fila__texto">
                      <span className="ui-fila__titulo">{p.nombre}</span>
                      <span className="ui-fila__ayuda">{ayudaDeFila(p, nombresDeEstacion)}</span>
                    </span>
                    <span className="agotados__interruptor">
                      <InterruptorDeAgotado producto={p} onCambio={alCambiarInterruptor} />
                    </span>
                    <EstadoDelProducto producto={p} pendiente={(pendientes[p.id] ?? 0) > 0} />
                  </div>
                )}
                columnas={[
                  {
                    id: 'nombre',
                    encabezado: 'Producto',
                    celda: (p) => <span className="agotados__nombre">{p.nombre}</span>,
                  },
                  {
                    id: 'estacion',
                    encabezado: 'Estación',
                    celda: (p) => ayudaDeFila(p, nombresDeEstacion),
                  },
                  {
                    id: 'estado',
                    encabezado: 'Estado',
                    celda: (p) => (
                      <EstadoDelProducto producto={p} pendiente={(pendientes[p.id] ?? 0) > 0} />
                    ),
                  },
                  {
                    id: 'agotado',
                    encabezado: 'Agotado',
                    alinear: 'derecha',
                    sinSaltos: true,
                    celda: (p) => (
                      <span className="agotados__interruptor agotados__interruptor--tabla">
                        <InterruptorDeAgotado producto={p} onCambio={alCambiarInterruptor} />
                      </span>
                    ),
                  },
                ]}
              />
            </section>
          ))
        )}

        <HojaDeAgotado
          producto={paraMarcar}
          hasta={hastaElegido}
          onHasta={setHastaElegido}
          corte={corte}
          afectados={paraMarcar ? afectadosPorAgotar(familias, paraMarcar.id) : null}
          onCerrar={() => setParaMarcar(null)}
          onConfirmar={() => {
            if (paraMarcar) marcar(paraMarcar, hastaElegido);
            setParaMarcar(null);
          }}
        />
      </>
    );
  }

  return (
    <Marco actual={actual} {...(pie ? { pie } : {})}>
      {contenido}
    </Marco>
  );
}

const plural = (cantidad: number, uno: string, varios: string) =>
  cantidad === 1 ? `${cantidad} ${uno}` : `${cantidad} ${varios}`;

function InterruptorDeAgotado({
  producto,
  onCambio,
}: {
  producto: ProductoDeVenta;
  onCambio: (producto: ProductoDeVenta, agotado: boolean) => void;
}) {
  return (
    <Interruptor
      etiqueta="Agotado"
      nombreAccesible={`Agotado: ${producto.nombre}`}
      marcado={producto.agotado !== null}
      onCambio={(marcado) => onCambio(producto, marcado)}
    />
  );
}

/** Etiquetas de estado de una fila y, si no se puede vender, por qué dicho con palabras. */
function EstadoDelProducto({
  producto,
  pendiente,
}: {
  producto: ProductoDeVenta;
  pendiente: boolean;
}) {
  const motivo = motivoEnPalabras(producto);
  const hay = pendiente || producto.agotado !== null || !producto.vendible;
  if (!hay) return null;
  return (
    <span className="agotados__estado">
      <span className="etiquetas">
        {pendiente ? <EtiquetaPendiente /> : null}
        {producto.agotado ? (
          <EtiquetaDeEstado tono="mal" icono={IconoError}>
            {etiquetaDeAgotado(producto.agotado)}
          </EtiquetaDeEstado>
        ) : !producto.vendible ? (
          <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
            No se puede vender
          </EtiquetaDeEstado>
        ) : null}
      </span>
      {motivo ? <span className="agotados__motivo">{motivo}</span> : null}
      {producto.motivo === 'MENU_SIN_ARMAR' ? (
        <Link to="/disponibilidad?ver=menu" className="enlace-texto">
          Armar el menú
        </Link>
      ) : null}
    </span>
  );
}

function SinResultados({
  soloAgotados,
  hayTexto,
  alVerTodos,
}: {
  soloAgotados: boolean;
  hayTexto: boolean;
  alVerTodos: () => void;
}) {
  if (soloAgotados && !hayTexto) {
    return (
      <EstadoVacio
        icono={IconoDisponibilidad}
        titulo="No hay productos agotados"
        accion={<Boton onClick={alVerTodos}>Ver todos los productos</Boton>}
      >
        Todo lo que ves en la carta de esta sucursal se puede vender.
      </EstadoVacio>
    );
  }
  return (
    <EstadoVacio
      icono={IconoBuscar}
      titulo="No encontramos productos"
      accion={
        soloAgotados ? <Boton onClick={alVerTodos}>Ver todos los productos</Boton> : undefined
      }
    >
      {hayTexto
        ? 'Prueba con otro nombre o cambia la estación.'
        : 'No hay productos en esta estación.'}
    </EstadoVacio>
  );
}

/** La hoja que pregunta hasta cuándo dura el agotado: "Solo por hoy" (por defecto) o "Hasta que lo reactive". */
function HojaDeAgotado({
  producto,
  hasta,
  onHasta,
  corte,
  afectados,
  onCerrar,
  onConfirmar,
}: {
  producto: ProductoDeVenta | null;
  hasta: HastaAgotado;
  onHasta: (hasta: HastaAgotado) => void;
  corte: string | null;
  afectados: { combos: string[]; comoOpcion: string[] } | null;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  const opciones: readonly OpcionConAyuda<HastaAgotado>[] = [
    {
      valor: 'FIN_DEL_DIA',
      titulo: 'Solo por hoy',
      ayuda: corte
        ? `Vuelve solo a las ${corte}, cuando empieza el siguiente día.`
        : 'Vuelve solo cuando empieza el siguiente día de la sucursal.',
    },
    {
      valor: 'REACTIVAR',
      titulo: 'Hasta que lo reactive',
      ayuda: 'Sigue agotado hasta que tú u otra persona lo reactive.',
    },
  ];
  const hayAfectados =
    afectados && (afectados.combos.length > 0 || afectados.comoOpcion.length > 0);
  return (
    <Hoja
      abierta={producto !== null}
      onCerrar={onCerrar}
      titulo={`Marcar «${producto?.nombre ?? ''}» como agotado`}
    >
      <OpcionesConAyuda
        etiqueta="¿Hasta cuándo?"
        opciones={opciones}
        valor={hasta}
        onCambio={onHasta}
      />
      {hayAfectados ? (
        <Aviso tipo="info" titulo="También se afecta lo que lo lleva" icono={IconoInfo}>
          {afectados.combos.length > 0
            ? `Dejará de poder venderse: ${afectados.combos.join(', ')}. `
            : null}
          {afectados.comoOpcion.length > 0
            ? `Dejará de poder elegirse como opción en: ${afectados.comoOpcion.join(', ')}.`
            : null}
        </Aviso>
      ) : null}
      <Boton variante="principal" bloque onClick={onConfirmar} data-foco-inicial>
        Marcar como agotado
      </Boton>
      <Boton bloque onClick={onCerrar}>
        Cancelar
      </Boton>
    </Hoja>
  );
}
