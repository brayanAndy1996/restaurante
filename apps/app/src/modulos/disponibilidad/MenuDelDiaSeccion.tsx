import type { MenuDelDiaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  Casilla,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  IconoAlerta,
  IconoDisponibilidad,
  IconoHistorial,
  IconoOk,
  Segmentos,
  claseBoton,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EtiquetaPendiente } from '../../componentes/PendienteDeEnvio';
import { enviarSinPerder } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { diaConFecha, montoEnSoles, montoEsCero, sumarDiasAFecha } from '../../lib/formato';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { motivoDeOpcionDelMenu } from './agotados';
import {
  CLAVES_DISPONIBILIDAD,
  armarMenuDelDia,
  consultarMenuDelDia,
  type SeccionDeDisponibilidad,
} from './disponibilidad';
import {
  copiarDeOtroDia,
  elegidasDe,
  estaSinArmar,
  hayCambiosDeMenu,
  opcionesQueFaltan,
  pluralPlatos,
  reglaDeTiempo,
  textoDeFaltantes,
} from './menu-del-dia';
import { useVistaDeSucursal } from './useVistaDeSucursal';

type Dia = 'hoy' | 'manana';

const OPCIONES_DE_DIA = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'manana', etiqueta: 'Mañana' },
] as const;

/** Lo marcado en pantalla por menú y por día, que aún no se guardó. Vive en la pantalla: un corte no lo borra. */
type Borradores = Record<string, Set<string>>;
const claveDeBorrador = (dia: string, productoId: string) => `${dia}|${productoId}`;

/** "+ S/ 5.00 de recargo" o "Sin recargo": el precio extra tal como lo guarda el grupo. */
function recargoEnPalabras(precioExtra: string): string {
  const monto = montoEnSoles(precioExtra);
  if (monto === null) return 'Sin recargo';
  return montoEsCero(precioExtra) ? 'Sin recargo' : `+ ${monto} de recargo`;
}

interface PropsMarco {
  actual: SeccionDeDisponibilidad;
  pie?: ReactNode;
  children: ReactNode;
}

/**
 * "Menú del día" de Disponibilidad (003, criterios 33 a 38 y 76): cada menú de la sucursal con "Hoy" y
 * "Mañana"; por tiempo, los platos candidatos como casillas grandes con su recargo y su estado;
 * "Repetir las de ayer" copia la selección del día anterior; "Guardar" manda lo marcado. Si hoy no está
 * armado, lo dice arriba. Quien arma el día es Cocina/Barra, el Supervisor o el Administrador
 * (`GESTIONAR_DISPONIBILIDAD`); los candidatos y los recargos se cambian en la carta.
 */
export function MenuDelDiaSeccion({
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
  const sucursalNombre = sesion.sucursal?.nombre ?? '';

  const [dia, setDia] = useState<Dia>('hoy');
  const [borradores, setBorradores] = useState<Borradores>({});
  const [guardando, setGuardando] = useState(false);
  const [pendientes, setPendientes] = useState<ReadonlySet<string>>(new Set());
  const [fallos, setFallos] = useState<string[]>([]);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [repitiendo, setRepitiendo] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [falloAlRepetir, setFalloAlRepetir] = useState<string | null>(null);

  // "Hoy" lo decide la API (día operativo de la sucursal): sin `dia`, su respuesta dice cuál es.
  const hoyConsulta = useQuery({
    queryKey: CLAVES_DISPONIBILIDAD.menuDeHoy(sucursalId),
    queryFn: ({ signal }) => consultarMenuDelDia(undefined, signal),
    enabled: sucursalId !== '',
  });
  const hoy = hoyConsulta.data?.[0]?.dia;
  const manana = hoy ? sumarDiasAFecha(hoy, 1) : undefined;
  const mananaConsulta = useQuery({
    queryKey: CLAVES_DISPONIBILIDAD.menuDelDia(sucursalId, manana ?? ''),
    queryFn: ({ signal }) => consultarMenuDelDia(manana, signal),
    enabled: dia === 'manana' && manana !== undefined,
  });

  const consulta = dia === 'hoy' ? hoyConsulta : mananaConsulta;
  const diaMostrado = dia === 'hoy' ? hoy : manana;
  const menus = consulta.data ?? [];

  // Por qué un plato "no está disponible": la respuesta del menú solo dice que no lo está; el motivo sale del
  // producto ligado en la vista de la sucursal. Se pide solo si hace falta (algún plato no disponible) y sin
  // refrescarla: si no llega, queda el texto genérico.
  const hayPlatosNoDisponibles = menus.some((m) =>
    m.grupos.some((g) => g.opciones.some((o) => !o.disponible && o.producto !== null)),
  );
  const vista = useVistaDeSucursal(sucursalId, {
    refrescar: false,
    habilitada: hayPlatosNoDisponibles,
  });
  const productosDeLaVista = useMemo(
    () =>
      new Map(
        vista.data?.vista.familias.flatMap((f) => f.productos).map((p) => [p.id, p] as const),
      ),
    [vista.data],
  );
  const motivoDeNoDisponible = (productoId: string | null): string =>
    motivoDeOpcionDelMenu(
      productoId === null || !vista.data ? null : (productosDeLaVista.get(productoId) ?? undefined),
    );

  const marcadasDe = (menu: MenuDelDiaRespuesta): ReadonlySet<string> =>
    borradores[claveDeBorrador(menu.dia, menu.productoId)] ?? elegidasDe(menu);
  const sucios = menus.filter((m) => hayCambiosDeMenu(m, marcadasDe(m)));
  const sinArmar = menus.filter(estaSinArmar);
  // Cambios sin guardar del otro día: no se pierden al cambiar de pestaña, pero se avisa.
  const otroDia = dia === 'hoy' ? manana : hoy;
  const suciosDelOtroDia = otroDia
    ? Object.keys(borradores).filter((k) => k.startsWith(`${otroDia}|`)).length
    : 0;

  function marcar(menu: MenuDelDiaRespuesta, modificadorId: string, marcada: boolean) {
    const siguiente = new Set(marcadasDe(menu));
    if (marcada) siguiente.add(modificadorId);
    else siguiente.delete(modificadorId);
    setBorradores((b) => ({ ...b, [claveDeBorrador(menu.dia, menu.productoId)]: siguiente }));
    setGuardado(null);
    setCopiado(null);
  }

  function actualizarCache(dia: string, guardadoAhora: MenuDelDiaRespuesta) {
    const reemplazar = (previos: MenuDelDiaRespuesta[] | undefined) =>
      previos?.map((m) => (m.productoId === guardadoAhora.productoId ? guardadoAhora : m));
    clientes.setQueryData<MenuDelDiaRespuesta[]>(
      CLAVES_DISPONIBILIDAD.menuDelDia(sucursalId, dia),
      reemplazar,
    );
    if (dia === hoy) {
      clientes.setQueryData<MenuDelDiaRespuesta[]>(
        CLAVES_DISPONIBILIDAD.menuDeHoy(sucursalId),
        reemplazar,
      );
    }
  }

  async function guardar() {
    if (guardando || sucios.length === 0 || !diaMostrado) return;
    setGuardando(true);
    setFallos([]);
    setGuardado(null);
    const diaGuardado = diaMostrado;
    const marcarPendiente = (productoId: string, esperando: boolean) =>
      setPendientes((previos) => {
        const siguientes = new Set(previos);
        if (esperando) siguientes.add(productoId);
        else siguientes.delete(productoId);
        return siguientes;
      });
    // Todos a la vez: sin red, cada menú queda "Pendiente de envío" y sale solo al volver.
    const resultados = await Promise.allSettled(
      sucios.map((menu) =>
        enviarSinPerder(
          (extra) =>
            armarMenuDelDia(
              menu.productoId,
              { dia: diaGuardado, opciones: [...marcadasDe(menu)] },
              extra,
            ),
          { alCambiar: (esperando) => marcarPendiente(menu.productoId, esperando) },
        ),
      ),
    );
    const nuevosFallos: string[] = [];
    let correctos = 0;
    resultados.forEach((resultado, i) => {
      const menu = sucios[i]!;
      if (resultado.status === 'fulfilled') {
        correctos += 1;
        actualizarCache(diaGuardado, resultado.value);
        setBorradores((b) => {
          const { [claveDeBorrador(diaGuardado, menu.productoId)]: _listo, ...resto } = b;
          return resto;
        });
      } else {
        nuevosFallos.push(`${menu.nombre}: ${falloDeMenu(resultado.reason)}`);
      }
    });
    if (nuevosFallos.length > 0) {
      void hoyConsulta.refetch();
      if (dia === 'manana') void mananaConsulta.refetch();
    }
    setFallos(nuevosFallos);
    if (correctos > 0) {
      setGuardado(
        correctos === 1 && menus.length === 1
          ? `El menú de ${dia === 'hoy' ? 'hoy' : 'mañana'} quedó guardado.`
          : `${correctos === 1 ? '1 menú guardado' : `${correctos} menús guardados`} para ${dia === 'hoy' ? 'hoy' : 'mañana'}.`,
      );
    }
    setGuardando(false);
  }

  async function repetir() {
    if (repitiendo || !hoy || !diaMostrado) return;
    const origenDia = dia === 'hoy' ? sumarDiasAFecha(hoy, -1) : hoy;
    setRepitiendo(true);
    setFalloAlRepetir(null);
    setCopiado(null);
    try {
      const origen = await clientes.fetchQuery({
        queryKey: CLAVES_DISPONIBILIDAD.menuDelDia(sucursalId, origenDia),
        queryFn: ({ signal }) => consultarMenuDelDia(origenDia, signal),
        staleTime: 0,
      });
      const siguientes: Borradores = {};
      let menusCopiados = 0;
      for (const menu of menus) {
        const copia = copiarDeOtroDia(
          menu,
          origen.find((o) => o.productoId === menu.productoId),
        );
        if (copia.size === 0) continue;
        menusCopiados += 1;
        siguientes[claveDeBorrador(menu.dia, menu.productoId)] = copia;
      }
      if (menusCopiados === 0) {
        setCopiado(
          `${dia === 'hoy' ? 'Ayer' : 'Hoy'} no había opciones armadas en ${menus.length === 1 ? 'este menú' : 'estos menús'}, así que no copiamos nada.`,
        );
      } else {
        setBorradores((b) => ({ ...b, ...siguientes }));
        setGuardado(null);
        setCopiado(
          `Copiamos las opciones de ${dia === 'hoy' ? 'ayer' : 'hoy'}. Revísalas y toca «Guardar».`,
        );
      }
    } catch (e) {
      setFalloAlRepetir(
        e instanceof ErrorApi && e.sinConexion
          ? 'No hay conexión con el servidor. Inténtalo de nuevo cuando vuelva.'
          : `No pudimos traer el menú de ${dia === 'hoy' ? 'ayer' : 'hoy'}. Inténtalo de nuevo.`,
      );
    } finally {
      setRepitiendo(false);
    }
  }

  const textoDia = dia === 'hoy' ? 'hoy' : 'mañana';
  const pie =
    menus.length > 0 ? (
      <Boton
        variante="principal"
        bloque
        cargando={guardando}
        textoCargando="Guardando…"
        disabled={sucios.length === 0}
        onClick={() => void guardar()}
      >
        {`Guardar el menú de ${textoDia}`}
      </Boton>
    ) : undefined;

  let contenido: ReactNode;
  if (sucursalId === '') {
    contenido = (
      <Aviso tipo="alerta" titulo="Elige primero tu sucursal">
        El menú del día se arma por sucursal.{' '}
        <Link to="/sucursal" className="enlace-texto">
          Elegir sucursal
        </Link>
      </Aviso>
    );
  } else if (hoyConsulta.isPending) {
    contenido = (
      <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando el menú del día" />
    );
  } else if (hoyConsulta.isError) {
    contenido = (
      <ErrorDeCarga
        titulo={
          hoyConsulta.error instanceof ErrorApi && hoyConsulta.error.sinConexion
            ? 'Sin conexión'
            : 'No pudimos cargar el menú del día'
        }
        onReintentar={() => void hoyConsulta.refetch()}
        reintentando={hoyConsulta.isFetching}
      >
        {mensajeDeError(hoyConsulta.error, {
          PROHIBIDO: 'No tienes permiso para armar el menú del día en esta sucursal.',
          SUCURSAL_NO_ELEGIDA: 'Elige primero tu sucursal.',
        })}
      </ErrorDeCarga>
    );
  } else if ((hoyConsulta.data ?? []).length === 0) {
    contenido = (
      <EstadoVacio
        icono={IconoDisponibilidad}
        titulo="Esta sucursal no tiene un menú del día"
        accion={
          puedeEditarLaCarta ? (
            <Link to="/carta/productos/nuevo" className={claseBoton('principal')}>
              Crear un menú del día
            </Link>
          ) : undefined
        }
      >
        {puedeEditarLaCarta
          ? 'Crea un producto de tipo «Menú del día» en la carta y aparecerá aquí para armarlo cada día.'
          : 'Pide al Administrador o a un Cajero que cree un producto de tipo «Menú del día» en la carta. También puede estar desactivado en esta sucursal.'}
      </EstadoVacio>
    );
  } else {
    contenido = (
      <>
        <div className="menu__dias">
          <Segmentos
            etiqueta="Día del menú"
            opciones={OPCIONES_DE_DIA}
            valor={dia}
            onCambio={(siguiente) => {
              setDia(siguiente);
              setGuardado(null);
              setFallos([]);
              setCopiado(null);
              setFalloAlRepetir(null);
            }}
          />
          <p className="menu__fecha">
            {diaMostrado ? <b>{diaConFecha(diaMostrado)}</b> : null}
            {sucursalNombre ? <span className="texto-ayuda">{sucursalNombre}</span> : null}
          </p>
        </div>

        {consulta.isPending ? (
          <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando el menú del día" />
        ) : consulta.isError ? (
          <ErrorDeCarga
            titulo={
              consulta.error instanceof ErrorApi && consulta.error.sinConexion
                ? 'Sin conexión'
                : 'No pudimos cargar el menú de mañana'
            }
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            {mensajeDeError(consulta.error)}
          </ErrorDeCarga>
        ) : (
          <>
            {sinArmar.length > 0 ? (
              <Aviso
                tipo={dia === 'hoy' ? 'alerta' : 'info'}
                titulo={
                  dia === 'hoy'
                    ? 'El menú de hoy no está armado: no se puede vender'
                    : 'El menú de mañana todavía no está armado'
                }
                icono={IconoAlerta}
              >
                {dia === 'hoy'
                  ? sinArmar.length === menus.length
                    ? 'Marca los platos que se ofrecen hoy y toca «Guardar».'
                    : `Falta armar: ${sinArmar.map((m) => m.nombre).join(', ')}.`
                  : 'Puedes dejarlo listo desde hoy. Empieza a valer cuando cambie el día.'}
              </Aviso>
            ) : null}
            {suciosDelOtroDia > 0 ? (
              <Aviso
                tipo="info"
                titulo={`Tienes cambios sin guardar en ${dia === 'hoy' ? 'mañana' : 'hoy'}`}
              >
                Siguen ahí. Vuelve a esa pestaña para guardarlos.
              </Aviso>
            ) : null}
            {guardado ? (
              <Aviso tipo="ok" titulo="Guardado">
                {guardado}
              </Aviso>
            ) : null}
            {fallos.length > 0 ? (
              <Aviso tipo="error" titulo="No pudimos guardar todo">
                <ul className="carta__usos">
                  {fallos.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                Lo que marcaste sigue en pantalla. Revisa y vuelve a tocar «Guardar».
              </Aviso>
            ) : null}
            {copiado ? (
              <Aviso tipo="info" titulo="Copiado">
                {copiado}
              </Aviso>
            ) : null}
            {falloAlRepetir ? (
              <Aviso tipo="error" titulo="No pudimos copiar">
                {falloAlRepetir}
              </Aviso>
            ) : null}

            <div className="menu__herramientas">
              <Boton
                icono={IconoHistorial}
                cargando={repitiendo}
                textoCargando="Copiando…"
                onClick={() => void repetir()}
              >
                {dia === 'hoy' ? 'Repetir las de ayer' : 'Repetir las de hoy'}
              </Boton>
            </div>

            <div className="menu__lista">
              {menus.map((menu) => (
                <MenuDeUnDia
                  key={`${menu.dia}|${menu.productoId}`}
                  menu={menu}
                  marcadas={marcadasDe(menu)}
                  pendiente={pendientes.has(menu.productoId)}
                  sinGuardar={hayCambiosDeMenu(menu, marcadasDe(menu))}
                  motivoDeNoDisponible={motivoDeNoDisponible}
                  onMarcar={(id, marcada) => marcar(menu, id, marcada)}
                />
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <Marco actual={actual} {...(pie ? { pie } : {})}>
      {contenido}
    </Marco>
  );
}

/** Lo que falló al guardar un menú, con la salida. */
function falloDeMenu(error: unknown): string {
  const e = error instanceof ErrorApi ? error : null;
  switch (e?.codigo) {
    case 'DATOS_INVALIDOS':
      return 'El día cambió mientras armabas el menú. Actualizamos la pantalla; marca de nuevo y guarda.';
    case 'REFERENCIA_INVALIDA':
      return 'Alguna de las opciones ya no es candidata de este menú. Actualizamos la lista.';
    case 'NO_ENCONTRADO':
      return 'Este menú ya no existe o no está disponible en esta sucursal.';
    case 'PROHIBIDO':
      return 'No tienes permiso para armar el menú del día en esta sucursal.';
    default:
      return mensajeDeError(error);
  }
}

interface PropsMenu {
  menu: MenuDelDiaRespuesta;
  marcadas: ReadonlySet<string>;
  pendiente: boolean;
  sinGuardar: boolean;
  /** Lo que se dice de un plato no disponible, según su producto ligado (`null` si no tiene). */
  motivoDeNoDisponible: (productoId: string | null) => string;
  onMarcar: (modificadorId: string, marcada: boolean) => void;
}

function MenuDeUnDia({
  menu,
  marcadas,
  pendiente,
  sinGuardar,
  motivoDeNoDisponible,
  onMarcar,
}: PropsMenu) {
  const armado = !estaSinArmar(menu);
  const precio = montoEnSoles(menu.precio);
  return (
    <section className="menu" aria-labelledby={`menu-${menu.productoId}`}>
      <header className="menu__encabezado">
        <div className="menu__titulo">
          <h2 className="menu__nombre" id={`menu-${menu.productoId}`}>
            {menu.nombre}
          </h2>
          {precio ? <span className="menu__precio">{precio}</span> : null}
        </div>
        <div className="etiquetas">
          {pendiente ? <EtiquetaPendiente /> : null}
          {sinGuardar && !pendiente ? (
            <EtiquetaDeEstado tono="info">Sin guardar</EtiquetaDeEstado>
          ) : null}
          {armado ? (
            <EtiquetaDeEstado tono="ok" icono={IconoOk}>
              Armado
            </EtiquetaDeEstado>
          ) : (
            <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
              Sin armar
            </EtiquetaDeEstado>
          )}
        </div>
      </header>

      {menu.grupos.map((grupo) => {
        const faltan = opcionesQueFaltan(grupo, marcadas);
        const ofrecidos = grupo.opciones.filter((o) => marcadas.has(o.modificadorId)).length;
        return (
          <fieldset key={grupo.id} className="menu__tiempo">
            <legend className="menu__tiempo-nombre">{grupo.nombre}</legend>
            <p className="texto-ayuda">
              {`${reglaDeTiempo(grupo)} · ${
                grupo.opciones.length === 0
                  ? 'sin platos'
                  : `se ofrecen ${ofrecidos} de ${pluralPlatos(grupo.opciones.length)}`
              }`}
            </p>
            {grupo.opciones.length === 0 ? (
              <p className="grupos__vacio">
                Este tiempo no tiene platos candidatos. Se agregan al grupo desde la carta.
              </p>
            ) : (
              <div className="menu__opciones">
                {grupo.opciones.map((opcion) => (
                  <Casilla
                    key={opcion.modificadorId}
                    etiqueta={opcion.nombre}
                    marcada={marcadas.has(opcion.modificadorId)}
                    onCambio={(marcada) => onMarcar(opcion.modificadorId, marcada)}
                    ayuda={
                      <>
                        {recargoEnPalabras(opcion.precioExtra)}
                        {opcion.disponible ? null : (
                          <>
                            {' · '}
                            <b className="menu__no-disponible">
                              {motivoDeNoDisponible(opcion.producto?.id ?? null)}
                            </b>
                          </>
                        )}
                      </>
                    }
                  />
                ))}
              </div>
            )}
            {faltan > 0 ? (
              <p className="menu__falta" role="status">
                <IconoAlerta size={16} aria-hidden="true" focusable="false" />
                {textoDeFaltantes(faltan)} para que se pueda vender.
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </section>
  );
}
