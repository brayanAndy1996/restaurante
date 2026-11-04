import type { CajaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoSeleccion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoMas,
  IconoPago,
  IconoTienda,
  claseBoton,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { useSesionActiva } from '../../acceso/sesion';
import { claveImpresoras, listarImpresoras } from '../impresion/impresion';
import { MarcoDeAjustes } from '../MarcoDeAjustes';
import {
  CAJA_VACIA,
  borradorDeCaja,
  cajaCambio,
  cajasOrdenadas,
  cambiosDeCaja,
  claveCajas,
  claveEmisores,
  claveSucursal,
  claveTasas,
  conCajaGuardada,
  configurarSerie,
  crearCaja,
  falloDeCaja,
  falloDeCambiarActiva,
  falloDeSerie,
  leerEmisorDeLaSucursal,
  listarCajas,
  listarEmisores,
  listarTasas,
  modificarCaja,
  pasosDeInicio,
  tasaVigente,
  textoDeCantidad,
  textoDeTurno,
  validarCaja,
  type BorradorDeCaja,
  type ErroresDeCaja,
  type EstadoDeTasa,
  type PasoDeInicio,
} from './cajas';
import { FormularioDeCaja } from './FormularioDeCaja';
import { ListaDeCajas } from './ListaDeCajas';
import { PrimerosPasos } from './PrimerosPasos';
import './caja.css';

type Modo = { tipo: 'lista' } | { tipo: 'nueva' } | { tipo: 'editar'; id: string };

const ID_FORMULARIO = 'formulario-de-caja';
const ID_TITULO_LISTA = 'cajas-lista';

/** Lleva la vista al primer problema del formulario: el campo con error o, si no hay, el aviso. */
function mostrarProblema() {
  requestAnimationFrame(() => {
    const formulario = document.getElementById(ID_FORMULARIO);
    const campo = formulario?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (campo) campo.focus();
    else formulario?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' });
  });
}

/**
 * Ajustes › Cajas (criterio 117 de 006): las cajas de una sucursal con su impresora y sus series, el alta y la
 * edición, activar y desactivar, y la guía de primeros pasos (pregunta 19). Solo el Administrador.
 */
export function CajasPagina() {
  const sesion = useSesionActiva();
  const [elegida, setElegida] = useState<string | undefined>(undefined);
  const sucursalId = elegida ?? sesion.sucursal?.id ?? sesion.sucursales[0]?.id;
  if (!sucursalId) {
    return (
      <MarcoDeAjustes actual="cajas">
        <EstadoVacio icono={IconoTienda} titulo="Aún no hay sucursales">
          Las cajas son de una sucursal. Cuando tu empresa tenga una, la verás aquí.
        </EstadoVacio>
      </MarcoDeAjustes>
    );
  }
  const selector =
    sesion.sucursales.length > 1 ? (
      <CampoSeleccion
        etiqueta="Sucursal"
        value={sucursalId}
        onChange={(e) => setElegida(e.target.value)}
      >
        {sesion.sucursales.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </CampoSeleccion>
    ) : null;
  return <CajasDeSucursal key={sucursalId} sucursalId={sucursalId} selector={selector} />;
}

function CajasDeSucursal({ sucursalId, selector }: { sucursalId: string; selector: ReactNode }) {
  const clientes = useQueryClient();
  const claveLista = claveCajas(sucursalId);

  const consultaCajas = useQuery({
    queryKey: claveLista,
    queryFn: ({ signal }) => listarCajas(sucursalId, signal),
  });
  const consultaImpresoras = useQuery({
    queryKey: claveImpresoras(sucursalId),
    queryFn: ({ signal }) => listarImpresoras(sucursalId, signal),
  });
  // Para la guía: el emisor de la sucursal, su régimen y si ya tiene una tasa de IGV que rija hoy.
  const consultaSucursal = useQuery({
    queryKey: claveSucursal(sucursalId),
    queryFn: ({ signal }) => leerEmisorDeLaSucursal(sucursalId, signal),
  });
  const emisorId = consultaSucursal.data?.emisorId;
  const consultaEmisores = useQuery({
    queryKey: claveEmisores,
    queryFn: ({ signal }) => listarEmisores(signal),
    enabled: emisorId !== undefined,
  });
  const consultaTasas = useQuery({
    queryKey: claveTasas(emisorId ?? ''),
    queryFn: ({ signal }) => listarTasas(emisorId ?? '', signal),
    enabled: emisorId !== undefined,
  });

  const cajas = consultaCajas.data;
  const lista = cajasOrdenadas(cajas ?? []);
  const impresoras = consultaImpresoras.data ?? [];

  const regimen = consultaEmisores.data?.find((e) => e.id === emisorId)?.regimen;
  const estadoDeTasa: EstadoDeTasa | undefined =
    regimen !== undefined && consultaTasas.data !== undefined
      ? {
          necesaria: regimen !== 'NUEVO_RUS',
          configurada: tasaVigente(consultaTasas.data) !== undefined,
        }
      : undefined;

  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [borrador, setBorrador] = useState<BorradorDeCaja>(CAJA_VACIA);
  const [errores, setErrores] = useState<ErroresDeCaja>({});
  const [fallo, setFallo] = useState<{ titulo: string; mensaje: string }>();
  const [falloActiva, setFalloActiva] = useState<{ titulo: string; mensaje: string }>();
  const [confirmacion, setConfirmacion] = useState('');

  const editando = modo.tipo === 'editar' ? lista.find((c) => c.id === modo.id) : undefined;
  // Si la caja elegida desaparece de la lista (otra sesión), se vuelve a ella.
  useEffect(() => {
    if (modo.tipo === 'editar' && cajas && !editando) setModo({ tipo: 'lista' });
  }, [modo, cajas, editando]);

  // Al abrir o cerrar el formulario, la pantalla empieza arriba.
  const clavePantalla = modo.tipo === 'editar' ? modo.id : modo.tipo;
  useEffect(() => {
    const marco = document.getElementById('contenido');
    if (marco) marco.scrollTop = 0;
  }, [clavePantalla]);

  // --- Escrituras: sin red no se pierden, quedan "Pendiente de envío" y salen solas -----------------
  const envio = useEnvioPendiente();
  const guardarEnCache = (guardada: CajaRespuesta) => {
    clientes.setQueryData<CajaRespuesta[]>(claveLista, (anterior) =>
      conCajaGuardada(anterior ?? [], guardada),
    );
  };

  const crearM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: Parameters<typeof crearCaja>[1]) =>
      envio.enviar((extra) => crearCaja(sucursalId, entrada, extra)),
    onSuccess: guardarEnCache,
  });
  const modificarM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { id: string; cambios: Parameters<typeof modificarCaja>[2] }) =>
      envio.enviar((extra) => modificarCaja(sucursalId, datos.id, datos.cambios, extra)),
    onSuccess: guardarEnCache,
  });
  const serieM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: {
      cajaId: string;
      tipo: Parameters<typeof configurarSerie>[2];
      entrada: Parameters<typeof configurarSerie>[3];
    }) =>
      envio.enviar((extra) =>
        configurarSerie(sucursalId, datos.cajaId, datos.tipo, datos.entrada, extra),
      ),
    onSuccess: guardarEnCache,
  });
  const guardando = crearM.isPending || modificarM.isPending || serieM.isPending;

  // --- Navegación ------------------------------------------------------------------------------------
  function limpiar() {
    setConfirmacion('');
    setErrores({});
    setFallo(undefined);
    setFalloActiva(undefined);
  }

  function volver() {
    limpiar();
    setModo({ tipo: 'lista' });
    requestAnimationFrame(() => document.getElementById(ID_TITULO_LISTA)?.focus());
  }

  function abrirNueva() {
    if (guardando) return;
    limpiar();
    setBorrador(CAJA_VACIA);
    setModo({ tipo: 'nueva' });
  }

  function abrirEditar(id: string) {
    const caja = lista.find((c) => c.id === id);
    if (!caja || guardando) return;
    limpiar();
    setBorrador(borradorDeCaja(caja));
    setModo({ tipo: 'editar', id });
  }

  function cambiar(parcial: Partial<BorradorDeCaja>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setErrores((e) => {
      const siguiente = { ...e };
      for (const campo of Object.keys(parcial) as (keyof BorradorDeCaja)[]) delete siguiente[campo];
      // Cambiar la serie deja atrás el error de su primer número (era de la serie anterior).
      if (parcial.serieBoleta !== undefined) delete siguiente.primerBoleta;
      if (parcial.serieFactura !== undefined) delete siguiente.primerFactura;
      return siguiente;
    });
    setFallo(undefined);
  }

  // --- Guardar, desactivar y reactivar ---------------------------------------------------------------
  async function guardar() {
    if (guardando || modo.tipo === 'lista') return;
    const resultado = validarCaja(borrador, lista, editando);
    if (!resultado.ok) {
      setErrores(resultado.errores);
      return mostrarProblema();
    }
    setErrores({});
    setFallo(undefined);

    // 1. La caja (nombre e impresora). Si falla, no se tocó nada más.
    let caja: CajaRespuesta | undefined = editando;
    try {
      if (modo.tipo === 'nueva') {
        caja = await crearM.mutateAsync({
          nombre: resultado.nombre,
          ...(resultado.impresoraId ? { impresoraId: resultado.impresoraId } : {}),
        });
        // Desde aquí la caja existe: si una serie falla, el formulario sigue abierto sobre ella.
        setModo({ tipo: 'editar', id: caja.id });
      } else if (editando) {
        const cambios = cambiosDeCaja(editando, resultado.nombre, resultado.impresoraId);
        if (Object.keys(cambios).length > 0) {
          caja = await modificarM.mutateAsync({ id: editando.id, cambios });
        }
      }
    } catch (error) {
      const traducido = falloDeCaja(error);
      setErrores(traducido.campos);
      if (traducido.general) {
        setFallo({ titulo: 'No pudimos guardar la caja', mensaje: traducido.general });
      }
      return mostrarProblema();
    }
    if (!caja) return;

    // 2. Las series que cambiaron, una por una: cada una que se guarda ya queda en la lista.
    for (const { tipo, entrada } of resultado.series) {
      try {
        caja = await serieM.mutateAsync({ cajaId: caja.id, tipo, entrada });
      } catch (error) {
        const traducido = falloDeSerie(error, tipo);
        setErrores(traducido.campos);
        const prefijo =
          modo.tipo === 'nueva'
            ? `La caja ${resultado.nombre} se creó, pero no pudimos guardar sus series. `
            : '';
        setFallo(
          traducido.general
            ? { titulo: 'No pudimos guardar la serie', mensaje: prefijo + traducido.general }
            : prefijo
              ? {
                  titulo: 'La caja se creó, pero falta una serie',
                  mensaje: 'Corrige el campo marcado y guarda otra vez.',
                }
              : undefined,
        );
        return mostrarProblema();
      }
    }

    const conSeries = caja.series.some((s) => s.activa);
    volver();
    setConfirmacion(
      modo.tipo === 'nueva'
        ? `Caja ${caja.nombre} creada.${conSeries ? '' : ' Dale una serie para que pueda emitir comprobantes.'}`
        : `Cambios de ${caja.nombre} guardados.`,
    );
  }

  async function cambiarActiva(activa: boolean) {
    if (!editando || guardando) return;
    setFalloActiva(undefined);
    try {
      await modificarM.mutateAsync({ id: editando.id, cambios: { activa } });
      volver();
      setConfirmacion(
        activa
          ? `Caja ${editando.nombre} reactivada.`
          : `Caja ${editando.nombre} desactivada. Conserva sus series y puedes reactivarla desde la lista.`,
      );
    } catch (error) {
      setFalloActiva(falloDeCambiarActiva(error, editando));
      mostrarProblema();
    }
  }

  // --- La guía de primeros pasos ---------------------------------------------------------------------
  const pasos = cajas ? pasosDeInicio(cajas, estadoDeTasa) : [];
  const primeraActiva = lista.find((c) => c.activa);
  function accionDelPaso(paso: PasoDeInicio): ReactNode {
    if (paso.id === 'series' && primeraActiva) {
      return (
        <Boton onClick={() => abrirEditar(primeraActiva.id)}>
          {`Poner series a ${primeraActiva.nombre}`}
        </Boton>
      );
    }
    if (paso.id === 'tasa') {
      return (
        <Link to="/administracion/emisores" className={claseBoton()}>
          Poner la tasa de IGV
        </Link>
      );
    }
    return null;
  }

  // --- Acción fija de abajo --------------------------------------------------------------------------
  let pie: ReactNode;
  if (modo.tipo === 'lista') {
    if (cajas) {
      pie = (
        <Boton variante="principal" bloque icono={IconoMas} onClick={abrirNueva}>
          Agregar caja
        </Boton>
      );
    }
  } else {
    pie = (
      <div className="fila-botones">
        <Boton onClick={volver} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton
          variante="principal"
          type="submit"
          form={ID_FORMULARIO}
          cargando={guardando}
          textoCargando="Guardando…"
          disabled={!!editando && !cajaCambio(editando, borrador, lista)}
        >
          {modo.tipo === 'nueva' ? 'Crear caja' : 'Guardar'}
        </Boton>
      </div>
    );
  }

  // --- Pantalla --------------------------------------------------------------------------------------
  let cuerpo: ReactNode;
  if (modo.tipo !== 'lista') {
    cuerpo = (
      <FormularioDeCaja
        formId={ID_FORMULARIO}
        titulo={editando ? editando.nombre : 'Nueva caja'}
        borrador={borrador}
        errores={errores}
        caja={editando}
        impresoras={impresoras}
        general={fallo}
        onCambio={cambiar}
        onEnviar={() => void guardar()}
        enfocarNombre={modo.tipo === 'nueva'}
      >
        {editando ? (
          <div className="ui-acciones__separada caja__grupo">
            {falloActiva ? (
              <Aviso tipo="error" titulo={falloActiva.titulo}>
                {falloActiva.mensaje}
              </Aviso>
            ) : null}
            {editando.activa ? (
              <>
                <p className="texto-ayuda">
                  {editando.turnoAbierto
                    ? `${textoDeTurno(editando)}. Para desactivarla, primero cierra ese turno.`
                    : 'Una caja desactivada no aparece al abrir turno y no se borra: conserva sus series y puedes reactivarla.'}
                </p>
                <Boton
                  variante="peligro"
                  bloque
                  disabled={guardando || !!editando.turnoAbierto}
                  onClick={() => void cambiarActiva(false)}
                >
                  Desactivar caja
                </Boton>
              </>
            ) : (
              <>
                <p className="texto-ayuda">
                  Está desactivada: no aparece al abrir turno. Sus series y su último número se
                  conservan.
                </p>
                <Boton bloque disabled={guardando} onClick={() => void cambiarActiva(true)}>
                  Reactivar caja
                </Boton>
              </>
            )}
          </div>
        ) : null}
      </FormularioDeCaja>
    );
  } else if (consultaCajas.isPending) {
    cuerpo = <EsqueletoDeLista etiqueta="Cargando las cajas" conInicial filas={3} />;
  } else if (consultaCajas.isError) {
    cuerpo = (
      <ErrorDeCarga
        titulo="No pudimos cargar las cajas"
        onReintentar={() => void consultaCajas.refetch()}
        reintentando={consultaCajas.isFetching}
      >
        {mensajeDeError(consultaCajas.error)}
      </ErrorDeCarga>
    );
  } else {
    const activas = lista.filter((c) => c.activa).length;
    cuerpo = (
      <>
        {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
        <PrimerosPasos pasos={pasos} accion={accionDelPaso} />
        <section className="caja__grupo" aria-labelledby={ID_TITULO_LISTA}>
          <h3 className="formulario__titulo" id={ID_TITULO_LISTA} tabIndex={-1}>
            Cajas
          </h3>
          {lista.length === 0 ? (
            <EstadoVacio icono={IconoPago} titulo="Aún no hay cajas">
              Toca “Agregar caja” para crear la primera. Cada caja lleva su impresora y sus series
              de boletas y facturas.
            </EstadoVacio>
          ) : (
            <>
              <p className="texto-ayuda" aria-live="polite">
                {textoDeCantidad(activas, lista.length)}
              </p>
              <ListaDeCajas cajas={lista} onElegir={abrirEditar} />
            </>
          )}
        </section>
      </>
    );
  }

  return (
    <MarcoDeAjustes actual="cajas" ancho="ancho" {...(pie ? { pie } : {})}>
      {modo.tipo === 'lista' ? selector : null}
      <AvisoPendiente pendiente={envio.pendiente} />
      {cuerpo}
    </MarcoDeAjustes>
  );
}
