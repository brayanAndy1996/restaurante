import type { MesaRespuesta, ZonaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  BotonDeSegmento,
  CuadriculaDeMesas,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoMapa,
  IconoMas,
  IconoOrdenar,
  Segmentos,
  moverEnLista,
  type MesaDeCuadricula,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { useSesionActiva } from '../../acceso/sesion';
import { MarcoDeAjustes } from '../MarcoDeAjustes';
import { FormularioDeMesa } from './FormularioDeMesa';
import { FormularioDeZona } from './FormularioDeZona';
import { MesasDesactivadas } from './MesasDesactivadas';
import { OrdenDeZonas } from './OrdenDeZonas';
import {
  POR_DEFECTO_DE_ZONA,
  borradorDeMesa,
  borradorDeZona,
  cambiosDeMesa,
  cambiosDeZona,
  claveZonas,
  conMesaGuardada,
  conZonaGuardada,
  crearMesa,
  crearZona,
  falloDeMesa,
  falloDeZona,
  listarZonas,
  mesaCambio,
  mesaEnCelda,
  mesasActivas,
  modificarMesa,
  modificarZona,
  mover,
  nombreSugerido,
  ordenarZonas,
  pluralMesas,
  primeraCeldaLibre,
  validarMesa,
  validarZona,
  type BorradorDeMesa,
  type BorradorDeZona,
  type Direccion,
  type ErroresDeMesa,
  type ErroresDeZona,
} from './mesas';

type Modo =
  | { tipo: 'ver' }
  | { tipo: 'mesa-nueva'; columna: number; fila: number }
  | { tipo: 'mesa'; id: string }
  | { tipo: 'zona-nueva' }
  | { tipo: 'zona-editar' }
  | { tipo: 'zonas-orden' };

const ID_FORMULARIO = 'formulario-del-mapa';

/** Al abrir un formulario debajo de la cuadrícula, la pantalla lo muestra sin que la persona deba buscarlo. */
function mostrarPanel(selector?: string) {
  requestAnimationFrame(() => {
    const panel =
      (selector ? document.querySelector(selector) : null) ??
      document.getElementById(ID_FORMULARIO) ??
      document.querySelector('.mapa__panel');
    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel?.scrollIntoView?.({ block: 'nearest', behavior: sinMovimiento ? 'auto' : 'smooth' });
  });
}

/** Mapa de mesas de Ajustes (criterios 1 a 6 y 88 en el dibujo): las zonas y la cuadrícula de cada una. */
export function MapaDeMesasPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <MarcoDeAjustes actual="mesas">
        <EstadoVacio icono={IconoMapa} titulo="Elige una sucursal">
          El mapa de mesas es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </MarcoDeAjustes>
    );
  }
  return <MapaDeSucursal key={sesion.sucursal.id} sucursal={sesion.sucursal} />;
}

function MapaDeSucursal({ sucursal }: { sucursal: { id: string; nombre: string } }) {
  const clientes = useQueryClient();
  const clave = claveZonas(sucursal.id);
  const consulta = useQuery({
    queryKey: clave,
    queryFn: ({ signal }) => listarZonas(sucursal.id, signal),
  });
  const zonas = useMemo(() => consulta.data ?? [], [consulta.data]);

  const [zonaElegidaId, setZonaElegidaId] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: 'ver' });
  const [confirmacion, setConfirmacion] = useState('');

  const [borradorMesa, setBorradorMesa] = useState<BorradorDeMesa | null>(null);
  const [erroresMesa, setErroresMesa] = useState<ErroresDeMesa>({});
  const [falloMesa, setFalloMesa] = useState<string>();
  const [avisoMover, setAvisoMover] = useState('');

  const [borradorZona, setBorradorZona] = useState<BorradorDeZona>(POR_DEFECTO_DE_ZONA);
  const [erroresZona, setErroresZona] = useState<ErroresDeZona>({});
  const [falloZona, setFalloZona] = useState<string>();

  const [ordenBorrador, setOrdenBorrador] = useState<ZonaRespuesta[] | null>(null);
  const [anuncioOrden, setAnuncioOrden] = useState('');
  const [falloOrden, setFalloOrden] = useState<string>();
  const [falloReactivar, setFalloReactivar] = useState<string>();

  // La zona elegida; si ya no existe (otra sesión la quitó) o no se eligió, la primera activa.
  const zona = zonas.find((z) => z.id === zonaElegidaId) ?? zonas.find((z) => z.activa) ?? zonas[0];

  // Si la mesa elegida desaparece de la zona (otra persona la desactivó), se vuelve a la vista.
  const mesaElegida = modo.tipo === 'mesa' ? zona?.mesas.find((m) => m.id === modo.id) : undefined;
  useEffect(() => {
    if (modo.tipo === 'mesa' && !mesaElegida) setModo({ tipo: 'ver' });
  }, [modo, mesaElegida]);

  // --- Escrituras: sin red no se pierden, quedan "Pendiente de envío" y salen solas -----------------
  const envio = useEnvioPendiente();
  const guardarZonas = (lista: ZonaRespuesta[]) => clientes.setQueryData(clave, lista);
  const enCache = () => clientes.getQueryData<ZonaRespuesta[]>(clave) ?? [];

  const crearZonaM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: Parameters<typeof crearZona>[1]) =>
      envio.enviar((extra) => crearZona(sucursal.id, entrada, extra)),
    onSuccess: (creada) => guardarZonas(conZonaGuardada(enCache(), creada)),
  });
  const modificarZonaM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { id: string; cambios: Parameters<typeof modificarZona>[2] }) =>
      envio.enviar((extra) => modificarZona(sucursal.id, datos.id, datos.cambios, extra)),
    onSuccess: (guardada) => guardarZonas(conZonaGuardada(enCache(), guardada)),
  });
  const ordenarZonasM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (ids: string[]) => envio.enviar((extra) => ordenarZonas(sucursal.id, ids, extra)),
    onSuccess: (lista) => guardarZonas(lista),
  });
  const crearMesaM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { zonaId: string; entrada: Parameters<typeof crearMesa>[2] }) =>
      envio.enviar((extra) => crearMesa(sucursal.id, datos.zonaId, datos.entrada, extra)),
    onSuccess: (mesa) => guardarZonas(conMesaGuardada(enCache(), mesa)),
  });
  const modificarMesaM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { id: string; cambios: Parameters<typeof modificarMesa>[2] }) =>
      envio.enviar((extra) => modificarMesa(sucursal.id, datos.id, datos.cambios, extra)),
    onSuccess: (mesa) => guardarZonas(conMesaGuardada(enCache(), mesa)),
  });

  const guardando =
    crearZonaM.isPending ||
    modificarZonaM.isPending ||
    ordenarZonasM.isPending ||
    crearMesaM.isPending ||
    modificarMesaM.isPending;

  // --- Navegación del editor -------------------------------------------------------------------------
  function limpiar() {
    setConfirmacion('');
    setErroresMesa({});
    setFalloMesa(undefined);
    setErroresZona({});
    setFalloZona(undefined);
    setFalloOrden(undefined);
    setFalloReactivar(undefined);
    setAvisoMover('');
  }

  function volver() {
    limpiar();
    setBorradorMesa(null);
    setOrdenBorrador(null);
    setModo({ tipo: 'ver' });
  }

  function elegirZona(id: string) {
    if (guardando) return;
    setZonaElegidaId(id);
    volver();
  }

  function abrirMesaNueva(columna: number, fila: number) {
    if (!zona || guardando) return;
    limpiar();
    setBorradorMesa({
      nombre: nombreSugerido(zonas),
      capacidad: '4',
      forma: 'CUADRADA',
      columna,
      fila,
    });
    setModo({ tipo: 'mesa-nueva', columna, fila });
    mostrarPanel();
  }

  function agregarMesa() {
    if (!zona) return;
    const celda = primeraCeldaLibre(zona);
    if (celda) abrirMesaNueva(celda.columna, celda.fila);
  }

  function elegirMesa(id: string) {
    if (guardando) return;
    const mesa = zona?.mesas.find((m) => m.id === id);
    if (!mesa) return;
    limpiar();
    setBorradorMesa(borradorDeMesa(mesa));
    setModo({ tipo: 'mesa', id });
    // Se muestran las flechas, justo debajo de la cuadrícula: la mesa se mueve viendo el dibujo.
    mostrarPanel('.mapa__mover');
  }

  function abrirZona(tipo: 'zona-nueva' | 'zona-editar') {
    if (guardando) return;
    limpiar();
    setBorradorMesa(null);
    setOrdenBorrador(null);
    setBorradorZona(tipo === 'zona-editar' && zona ? borradorDeZona(zona) : POR_DEFECTO_DE_ZONA);
    setModo({ tipo });
    mostrarPanel();
  }

  function abrirOrden() {
    if (guardando) return;
    limpiar();
    setBorradorMesa(null);
    setOrdenBorrador(zonas);
    setModo({ tipo: 'zonas-orden' });
    mostrarPanel();
  }

  // --- Mesas -------------------------------------------------------------------------------------------
  function moverBorrador(direccion: Direccion) {
    if (!zona || !borradorMesa || modo.tipo !== 'mesa') return;
    const resultado = mover(zona, modo.id, borradorMesa, direccion);
    if (!resultado.ok) return setAvisoMover(resultado.motivo);
    setBorradorMesa({ ...borradorMesa, columna: resultado.columna, fila: resultado.fila });
    setErroresMesa((e) => ({ ...e, celda: undefined }));
    setAvisoMover(`Ahora está en la columna ${resultado.columna}, fila ${resultado.fila}.`);
  }

  function cambiarMesa(parcial: Partial<BorradorDeMesa>) {
    setBorradorMesa((b) => (b ? { ...b, ...parcial } : b));
    setErroresMesa((e) => {
      const siguiente = { ...e };
      if (parcial.nombre !== undefined) delete siguiente.nombre;
      if (parcial.capacidad !== undefined) delete siguiente.capacidad;
      return siguiente;
    });
    setFalloMesa(undefined);
  }

  async function guardarMesa() {
    if (!zona || !borradorMesa || guardando) return;
    if (modo.tipo !== 'mesa-nueva' && modo.tipo !== 'mesa') return;
    const editando = modo.tipo === 'mesa' ? mesaElegida : undefined;
    const resultado = validarMesa(borradorMesa, {
      zona,
      zonas,
      ...(editando ? { mesaId: editando.id } : {}),
    });
    if (!resultado.ok) return setErroresMesa(resultado.errores);
    setErroresMesa({});
    setFalloMesa(undefined);
    try {
      if (editando) {
        const cambios = cambiosDeMesa(editando, resultado.mesa);
        if (Object.keys(cambios).length === 0) return volver();
        await modificarMesaM.mutateAsync({ id: editando.id, cambios });
        volver();
        setConfirmacion(`Cambios de la mesa ${resultado.mesa.nombre} guardados.`);
      } else {
        await crearMesaM.mutateAsync({ zonaId: zona.id, entrada: resultado.mesa });
        volver();
        setConfirmacion(`Mesa ${resultado.mesa.nombre} creada.`);
      }
    } catch (error) {
      const fallo = falloDeMesa(error);
      setErroresMesa(fallo.campos);
      setFalloMesa(fallo.general);
    }
  }

  async function desactivarMesa() {
    if (!mesaElegida || guardando) return;
    setFalloMesa(undefined);
    try {
      await modificarMesaM.mutateAsync({ id: mesaElegida.id, cambios: { activa: false } });
      volver();
      setConfirmacion(`Mesa ${mesaElegida.nombre} desactivada. Puedes reactivarla más abajo.`);
    } catch (error) {
      setFalloMesa(falloDeMesa(error).general ?? mensajeDeError(error));
    }
  }

  const [reactivando, setReactivando] = useState<string | null>(null);
  async function reactivarMesa(mesa: MesaRespuesta) {
    if (!zona || reactivando) return;
    limpiar();
    const repetida = zonas.some((z) =>
      mesasActivas(z).some(
        (m) =>
          m.nombre.trim().toLocaleLowerCase('es-PE') ===
          mesa.nombre.trim().toLocaleLowerCase('es-PE'),
      ),
    );
    if (repetida) {
      return setFalloReactivar(
        `Ya hay otra mesa activa con el nombre ${mesa.nombre}. Cámbiale el nombre a esa o déjala desactivada.`,
      );
    }
    // Si su celda la tomó otra mesa, vuelve en la primera celda libre.
    const cambios: Parameters<typeof modificarMesa>[2] = { activa: true };
    let nuevaCelda: { columna: number; fila: number } | null = null;
    if (mesaEnCelda(zona, mesa.columna, mesa.fila, mesa.id)) {
      nuevaCelda = primeraCeldaLibre(zona);
      if (!nuevaCelda) {
        return setFalloReactivar(
          `La zona ${zona.nombre} no tiene celdas libres. Agranda la cuadrícula para reactivar la mesa ${mesa.nombre}.`,
        );
      }
      cambios.columna = nuevaCelda.columna;
      cambios.fila = nuevaCelda.fila;
    }
    setReactivando(mesa.id);
    try {
      await modificarMesaM.mutateAsync({ id: mesa.id, cambios });
      setConfirmacion(
        nuevaCelda
          ? `Mesa ${mesa.nombre} reactivada en la columna ${nuevaCelda.columna}, fila ${nuevaCelda.fila}, porque su celda ya estaba ocupada.`
          : `Mesa ${mesa.nombre} reactivada.`,
      );
    } catch (error) {
      setFalloReactivar(falloDeMesa(error).general ?? 'Esa celda o ese nombre ya están en uso.');
    } finally {
      setReactivando(null);
    }
  }

  // --- Zonas -------------------------------------------------------------------------------------------
  function cambiarZona(parcial: Partial<BorradorDeZona>) {
    setBorradorZona((b) => ({ ...b, ...parcial }));
    setErroresZona((e) => {
      const siguiente = { ...e };
      for (const campo of Object.keys(parcial) as (keyof BorradorDeZona)[]) delete siguiente[campo];
      return siguiente;
    });
    setFalloZona(undefined);
  }

  async function guardarZona() {
    if (guardando || (modo.tipo !== 'zona-nueva' && modo.tipo !== 'zona-editar')) return;
    const editando = modo.tipo === 'zona-editar' ? zona : undefined;
    const resultado = validarZona(borradorZona, zonas, editando);
    if (!resultado.ok) return setErroresZona(resultado.errores);
    setErroresZona({});
    setFalloZona(undefined);
    try {
      if (editando) {
        const cambios = cambiosDeZona(editando, resultado.zona);
        if (Object.keys(cambios).length === 0) return volver();
        await modificarZonaM.mutateAsync({ id: editando.id, cambios });
        volver();
        setConfirmacion(`Zona ${resultado.zona.nombre} guardada.`);
      } else {
        const creada = await crearZonaM.mutateAsync(resultado.zona);
        setZonaElegidaId(creada.id);
        volver();
        setConfirmacion(`Zona ${creada.nombre} creada. Toca una celda para crear su primera mesa.`);
      }
    } catch (error) {
      const fallo = falloDeZona(error);
      setErroresZona(fallo.campos);
      setFalloZona(fallo.general);
    }
  }

  async function cambiarActivaDeZona(activa: boolean) {
    if (!zona || guardando) return;
    setFalloZona(undefined);
    try {
      await modificarZonaM.mutateAsync({ id: zona.id, cambios: { activa } });
      volver();
      setConfirmacion(
        activa ? `Zona ${zona.nombre} reactivada.` : `Zona ${zona.nombre} desactivada.`,
      );
    } catch (error) {
      setFalloZona(falloDeZona(error).general ?? mensajeDeError(error));
    }
  }

  function moverZona(desde: number, hacia: number) {
    if (!ordenBorrador) return;
    const nueva = moverEnLista(ordenBorrador, desde, hacia);
    setOrdenBorrador(nueva);
    const movida = nueva[hacia];
    if (movida) setAnuncioOrden(`${movida.nombre}: posición ${hacia + 1} de ${nueva.length}`);
  }

  async function guardarOrden() {
    if (!ordenBorrador || guardando) return;
    setFalloOrden(undefined);
    try {
      await ordenarZonasM.mutateAsync(ordenBorrador.map((z) => z.id));
      volver();
      setConfirmacion('Orden de las zonas guardado.');
    } catch (error) {
      setFalloOrden(mensajeDeError(error));
    }
  }

  // --- Dibujo ------------------------------------------------------------------------------------------
  const mesasDelDibujo: MesaDeCuadricula[] = useMemo(() => {
    if (!zona) return [];
    return mesasActivas(zona).map((m) => {
      const enEdicion = modo.tipo === 'mesa' && modo.id === m.id && borradorMesa;
      const capacidad = enEdicion ? Number(borradorMesa.capacidad) : m.capacidad;
      return {
        id: m.id,
        nombre: enEdicion ? borradorMesa.nombre.trim() || m.nombre : m.nombre,
        capacidad: Number.isInteger(capacidad) && capacidad >= 1 ? capacidad : m.capacidad,
        forma: enEdicion ? borradorMesa.forma : m.forma,
        columna: enEdicion ? borradorMesa.columna : m.columna,
        fila: enEdicion ? borradorMesa.fila : m.fila,
      };
    });
  }, [zona, modo, borradorMesa]);

  const opcionesDeZona = zonas.map((z) => ({
    valor: z.id,
    etiqueta: z.activa ? z.nombre : `${z.nombre} (inactiva)`,
  }));

  // --- Acción fija de abajo ---------------------------------------------------------------------------
  let pie: ReactNode;
  const cancelar = (
    <Boton onClick={volver} disabled={guardando}>
      Cancelar
    </Boton>
  );
  if (modo.tipo === 'mesa-nueva') {
    pie = (
      <div className="fila-botones">
        {cancelar}
        <Boton
          variante="principal"
          type="submit"
          form={ID_FORMULARIO}
          cargando={guardando}
          textoCargando="Guardando…"
        >
          Crear mesa
        </Boton>
      </div>
    );
  } else if (modo.tipo === 'mesa') {
    pie = (
      <div className="fila-botones">
        {cancelar}
        <Boton
          variante="principal"
          type="submit"
          form={ID_FORMULARIO}
          cargando={guardando}
          textoCargando="Guardando…"
          disabled={!mesaElegida || !borradorMesa || !mesaCambio(mesaElegida, borradorMesa)}
        >
          Guardar
        </Boton>
      </div>
    );
  } else if (modo.tipo === 'zona-nueva' || modo.tipo === 'zona-editar') {
    pie = (
      <div className="fila-botones">
        {cancelar}
        <Boton
          variante="principal"
          type="submit"
          form={ID_FORMULARIO}
          cargando={guardando}
          textoCargando="Guardando…"
        >
          {modo.tipo === 'zona-nueva' ? 'Crear zona' : 'Guardar zona'}
        </Boton>
      </div>
    );
  } else if (modo.tipo === 'zonas-orden') {
    const cambio = ordenBorrador?.some((z, i) => z.id !== zonas[i]?.id) ?? false;
    pie = (
      <div className="fila-botones">
        {cancelar}
        <Boton
          variante="principal"
          cargando={guardando}
          textoCargando="Guardando…"
          disabled={!cambio}
          onClick={() => void guardarOrden()}
        >
          Guardar orden
        </Boton>
      </div>
    );
  } else if (zona?.activa && primeraCeldaLibre(zona)) {
    pie = (
      <Boton variante="principal" bloque icono={IconoMas} onClick={agregarMesa}>
        Agregar mesa
      </Boton>
    );
  }

  // --- Pantalla -----------------------------------------------------------------------------------------
  const cuerpo = consulta.isPending ? (
    <EsqueletoDeLista etiqueta="Cargando el mapa de mesas" conInicial={false} filas={3} />
  ) : consulta.isError ? (
    <ErrorDeCarga
      titulo="No pudimos cargar el mapa de mesas"
      onReintentar={() => void consulta.refetch()}
      reintentando={consulta.isFetching}
    >
      {mensajeDeError(consulta.error)}
    </ErrorDeCarga>
  ) : !zona ? (
    modo.tipo === 'zona-nueva' ? (
      <FormularioDeZona
        formId={ID_FORMULARIO}
        titulo="Nueva zona"
        borrador={borradorZona}
        errores={erroresZona}
        general={falloZona}
        onCambio={cambiarZona}
        onEnviar={() => void guardarZona()}
        enfocarNombre
      />
    ) : (
      <EstadoVacio
        icono={IconoMapa}
        titulo="Aún no hay zonas"
        accion={
          <Boton variante="principal" icono={IconoMas} onClick={() => abrirZona('zona-nueva')}>
            Agregar zona
          </Boton>
        }
      >
        Crea la primera zona, por ejemplo Salón principal o Terraza, y dibuja en ella dónde está
        cada mesa.
      </EstadoVacio>
    )
  ) : (
    <>
      <Segmentos
        etiqueta="Zonas del salón"
        opciones={opcionesDeZona}
        valor={zona.id}
        onCambio={elegirZona}
      >
        <BotonDeSegmento
          icono={IconoMas}
          onClick={() => abrirZona('zona-nueva')}
          disabled={guardando}
        >
          Nueva zona
        </BotonDeSegmento>
      </Segmentos>

      {modo.tipo === 'zonas-orden' && ordenBorrador ? (
        <>
          {falloOrden ? (
            <Aviso tipo="error" titulo="No pudimos guardar el orden">
              {falloOrden}
            </Aviso>
          ) : null}
          <OrdenDeZonas
            zonas={ordenBorrador}
            anuncio={anuncioOrden}
            onSubir={(i) => moverZona(i, i - 1)}
            onBajar={(i) => moverZona(i, i + 1)}
          />
        </>
      ) : (
        <>
          <div className="carta__resumen">
            <p className="texto-ayuda" aria-live="polite">
              {zona.columnas} × {zona.filas} celdas · {pluralMesas(mesasActivas(zona).length)}
              {zona.activa ? '' : ' · Zona inactiva'}
            </p>
            <Boton
              variante="texto"
              onClick={() => abrirZona('zona-editar')}
              disabled={guardando}
              aria-label={`Editar la zona ${zona.nombre}`}
            >
              Editar zona
            </Boton>
          </div>

          {!zona.activa ? (
            <Aviso tipo="info" titulo="Esta zona está inactiva">
              No aparece en el salón. Reactívala desde “Editar zona” cuando la vuelvas a usar.
            </Aviso>
          ) : null}
          {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
          {mesasActivas(zona).length === 0 && modo.tipo === 'ver' && zona.activa ? (
            <p className="texto-ayuda">Toca una celda libre para crear tu primera mesa.</p>
          ) : null}

          <CuadriculaDeMesas
            etiqueta={`Mesas de ${zona.nombre}`}
            columnas={zona.columnas}
            filas={zona.filas}
            mesas={mesasDelDibujo}
            mesaElegidaId={modo.tipo === 'mesa' ? modo.id : null}
            onElegirMesa={elegirMesa}
            celdaElegida={
              modo.tipo === 'mesa-nueva' ? { columna: modo.columna, fila: modo.fila } : null
            }
            onElegirCelda={abrirMesaNueva}
          />
          {modo.tipo === 'ver' && mesasActivas(zona).length > 0 ? (
            <p className="texto-ayuda">
              Toca una celda libre para crear una mesa. Toca una mesa para cambiar sus datos o
              moverla.
            </p>
          ) : null}
          {falloReactivar ? (
            <Aviso tipo="error" titulo="No pudimos reactivar la mesa">
              {falloReactivar}
            </Aviso>
          ) : null}

          {modo.tipo === 'mesa-nueva' && borradorMesa ? (
            <FormularioDeMesa
              formId={ID_FORMULARIO}
              titulo="Nueva mesa"
              lugar={`Columna ${borradorMesa.columna}, fila ${borradorMesa.fila}`}
              borrador={borradorMesa}
              errores={erroresMesa}
              general={falloMesa}
              onCambio={cambiarMesa}
              onEnviar={() => void guardarMesa()}
              enfocarNombre
            />
          ) : null}
          {modo.tipo === 'mesa' && mesaElegida && borradorMesa ? (
            <FormularioDeMesa
              formId={ID_FORMULARIO}
              titulo={`Mesa ${mesaElegida.nombre}`}
              lugar={`Columna ${borradorMesa.columna}, fila ${borradorMesa.fila}`}
              borrador={borradorMesa}
              errores={erroresMesa}
              general={falloMesa}
              onCambio={cambiarMesa}
              onEnviar={() => void guardarMesa()}
              mover={{ onMover: moverBorrador, aviso: avisoMover }}
            >
              <div className="ui-acciones__separada">
                <p className="texto-ayuda">
                  Una mesa desactivada no aparece en el salón ni ocupa celda. Si tiene una cuenta
                  abierta, primero hay que cerrarla.
                </p>
                <Boton
                  variante="peligro"
                  bloque
                  disabled={guardando}
                  onClick={() => void desactivarMesa()}
                >
                  Desactivar mesa
                </Boton>
              </div>
            </FormularioDeMesa>
          ) : null}
          {modo.tipo === 'zona-nueva' || modo.tipo === 'zona-editar' ? (
            <FormularioDeZona
              formId={ID_FORMULARIO}
              titulo={modo.tipo === 'zona-nueva' ? 'Nueva zona' : `Zona ${zona.nombre}`}
              borrador={borradorZona}
              errores={erroresZona}
              general={falloZona}
              onCambio={cambiarZona}
              onEnviar={() => void guardarZona()}
              enfocarNombre={modo.tipo === 'zona-nueva'}
            >
              {modo.tipo === 'zona-editar' && zonas.length > 1 ? (
                <Boton
                  variante="texto"
                  icono={IconoOrdenar}
                  onClick={abrirOrden}
                  disabled={guardando}
                >
                  Ordenar las zonas
                </Boton>
              ) : null}
              {modo.tipo === 'zona-editar' ? (
                <div className="ui-acciones__separada">
                  {zona.activa ? (
                    <>
                      {mesasActivas(zona).length > 0 ? (
                        <p className="texto-ayuda">
                          {mesasActivas(zona).length === 1
                            ? 'Tiene 1 mesa activa. Desactívala o pásala'
                            : `Tiene ${mesasActivas(zona).length} mesas activas. Desactívalas o pásalas`}{' '}
                          a otra zona antes de desactivar la zona.
                        </p>
                      ) : (
                        <p className="texto-ayuda">
                          Una zona desactivada no aparece en el salón. Podrás reactivarla.
                        </p>
                      )}
                      <Boton
                        variante="peligro"
                        bloque
                        disabled={guardando || mesasActivas(zona).length > 0}
                        onClick={() => void cambiarActivaDeZona(false)}
                      >
                        Desactivar zona
                      </Boton>
                    </>
                  ) : (
                    <Boton
                      bloque
                      disabled={guardando}
                      onClick={() => void cambiarActivaDeZona(true)}
                    >
                      Reactivar zona
                    </Boton>
                  )}
                </div>
              ) : null}
            </FormularioDeZona>
          ) : null}

          {modo.tipo === 'ver' ? (
            <MesasDesactivadas
              mesas={zona.mesas.filter((m) => !m.activa)}
              reactivando={reactivando}
              onReactivar={(m) => void reactivarMesa(m)}
            />
          ) : null}
        </>
      )}
    </>
  );

  return (
    <MarcoDeAjustes actual="mesas" ancho="ancho" {...(pie ? { pie } : {})}>
      <AvisoPendiente pendiente={envio.pendiente} />
      {cuerpo}
    </MarcoDeAjustes>
  );
}
