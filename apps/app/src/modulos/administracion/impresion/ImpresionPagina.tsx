import type { ImpresoraRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoImpresora,
  IconoMas,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { useSesionActiva } from '../../acceso/sesion';
import { MarcoDeAjustes } from '../MarcoDeAjustes';
import { DondeSaleCadaEstacion, ImpresoraDeCaja } from './DestinosDeImpresion';
import { FormularioDeImpresora } from './FormularioDeImpresora';
import { ListaDeImpresoras } from './ListaDeImpresoras';
import {
  POR_DEFECTO_DE_IMPRESORA,
  borradorDeImpresora,
  cambiosDeImpresora,
  claveDestinos,
  claveImpresoraDeCaja,
  claveImpresoras,
  conImpresoraGuardada,
  crearImpresora,
  falloDeDesactivar,
  falloDeImpresora,
  impresoraCambio,
  leerImpresoraDeCaja,
  listarDestinos,
  listarImpresoras,
  modificarImpresora,
  ordenadas,
  unirNombres,
  usosDeImpresora,
  validarImpresora,
  type BorradorDeImpresora,
  type ErroresDeImpresora,
} from './impresion';
import './impresion.css';

type Modo = { tipo: 'lista' } | { tipo: 'nueva' } | { tipo: 'editar'; id: string };

const ID_FORMULARIO = 'formulario-de-impresora';
const ID_TITULO_LISTA = 'impresion-impresoras';

/** Lleva la vista al primer problema del formulario: el campo con error o, si no hay, el aviso. */
function mostrarProblema() {
  requestAnimationFrame(() => {
    const formulario = document.getElementById(ID_FORMULARIO);
    const campo = formulario?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (campo) campo.focus();
    else formulario?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' });
  });
}

/** Ajustes › Impresión (criterios 99 a 105, 136 y 137 en parte): impresoras, destinos y caja. */
export function ImpresionPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <MarcoDeAjustes actual="impresion">
        <EstadoVacio icono={IconoImpresora} titulo="Elige una sucursal">
          Las impresoras son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </MarcoDeAjustes>
    );
  }
  return <ImpresionDeSucursal key={sesion.sucursal.id} sucursalId={sesion.sucursal.id} />;
}

function ImpresionDeSucursal({ sucursalId }: { sucursalId: string }) {
  const clientes = useQueryClient();
  const claveLista = claveImpresoras(sucursalId);

  const consultaImpresoras = useQuery({
    queryKey: claveLista,
    queryFn: ({ signal }) => listarImpresoras(sucursalId, signal),
  });
  const consultaDestinos = useQuery({
    queryKey: claveDestinos(sucursalId),
    queryFn: ({ signal }) => listarDestinos(sucursalId, signal),
  });
  const consultaCaja = useQuery({
    queryKey: claveImpresoraDeCaja(sucursalId),
    queryFn: ({ signal }) => leerImpresoraDeCaja(sucursalId, signal),
  });

  const impresoras = consultaImpresoras.data;
  const lista = ordenadas(impresoras ?? []);

  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [borrador, setBorrador] = useState<BorradorDeImpresora>(POR_DEFECTO_DE_IMPRESORA);
  const [errores, setErrores] = useState<ErroresDeImpresora>({});
  const [fallo, setFallo] = useState<string>();
  const [falloDesactivar, setFalloDesactivar] = useState<{ titulo: string; mensaje: string }>();
  const [confirmacion, setConfirmacion] = useState('');

  const editando = modo.tipo === 'editar' ? lista.find((i) => i.id === modo.id) : undefined;
  // Si la impresora elegida desaparece de la lista (otra sesión), se vuelve a ella.
  useEffect(() => {
    if (modo.tipo === 'editar' && impresoras && !editando) setModo({ tipo: 'lista' });
  }, [modo, impresoras, editando]);

  // Al abrir o cerrar el formulario, la pantalla empieza arriba.
  const clavePantalla = modo.tipo === 'editar' ? modo.id : modo.tipo;
  useEffect(() => {
    const marco = document.getElementById('contenido');
    if (marco) marco.scrollTop = 0;
  }, [clavePantalla]);

  // --- Escrituras: sin red no se pierden, quedan "Pendiente de envío" y salen solas -----------------
  const envio = useEnvioPendiente();
  const guardarEnCache = (guardada: ImpresoraRespuesta) =>
    clientes.setQueryData<ImpresoraRespuesta[]>(claveLista, (anterior) =>
      conImpresoraGuardada(anterior ?? [], guardada),
    );

  const crearM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: Parameters<typeof crearImpresora>[1]) =>
      envio.enviar((extra) => crearImpresora(sucursalId, entrada, extra)),
    onSuccess: guardarEnCache,
  });
  const modificarM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { id: string; cambios: Parameters<typeof modificarImpresora>[2] }) =>
      envio.enviar((extra) => modificarImpresora(sucursalId, datos.id, datos.cambios, extra)),
    onSuccess: guardarEnCache,
  });
  const guardando = crearM.isPending || modificarM.isPending;

  // --- Navegación ------------------------------------------------------------------------------------
  function limpiar() {
    setConfirmacion('');
    setErrores({});
    setFallo(undefined);
    setFalloDesactivar(undefined);
  }

  function volver() {
    limpiar();
    setModo({ tipo: 'lista' });
    requestAnimationFrame(() => document.getElementById(ID_TITULO_LISTA)?.focus());
  }

  function abrirNueva() {
    if (guardando) return;
    limpiar();
    setBorrador(POR_DEFECTO_DE_IMPRESORA);
    setModo({ tipo: 'nueva' });
  }

  function abrirEditar(id: string) {
    const impresora = lista.find((i) => i.id === id);
    if (!impresora || guardando) return;
    limpiar();
    setBorrador(borradorDeImpresora(impresora));
    setModo({ tipo: 'editar', id });
  }

  function cambiar(parcial: Partial<BorradorDeImpresora>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setErrores((e) => {
      const siguiente = { ...e };
      for (const campo of Object.keys(parcial) as (keyof BorradorDeImpresora)[]) {
        if (campo in siguiente) delete siguiente[campo as keyof ErroresDeImpresora];
      }
      // Cambiar de red a Bluetooth deja atrás los errores de la otra conexión.
      if (parcial.tipo !== undefined) {
        delete siguiente.host;
        delete siguiente.puerto;
        delete siguiente.mac;
      }
      return siguiente;
    });
    setFallo(undefined);
  }

  // --- Guardar, desactivar y reactivar ---------------------------------------------------------------
  async function guardar() {
    if (guardando || modo.tipo === 'lista') return;
    const resultado = validarImpresora(borrador, impresoras ?? [], editando?.id);
    if (!resultado.ok) {
      setErrores(resultado.errores);
      return mostrarProblema();
    }
    setErrores({});
    setFallo(undefined);
    try {
      if (modo.tipo === 'editar') {
        if (!editando) return;
        const cambios = cambiosDeImpresora(editando, resultado.impresora);
        if (Object.keys(cambios).length === 0) return volver();
        await modificarM.mutateAsync({ id: editando.id, cambios });
        volver();
        setConfirmacion(`Cambios de ${resultado.impresora.nombre} guardados.`);
      } else {
        const creada = await crearM.mutateAsync(resultado.impresora);
        volver();
        setConfirmacion(
          `Impresora ${creada.nombre} creada. Elígela en “Dónde sale cada estación” para usarla.`,
        );
      }
    } catch (error) {
      const resultadoError = falloDeImpresora(error);
      setErrores(resultadoError.campos);
      setFallo(resultadoError.general);
      mostrarProblema();
    }
  }

  async function cambiarActiva(activa: boolean) {
    if (!editando || guardando) return;
    setFalloDesactivar(undefined);
    try {
      await modificarM.mutateAsync({ id: editando.id, cambios: { activa } });
      volver();
      setConfirmacion(
        activa
          ? `Impresora ${editando.nombre} reactivada.`
          : `Impresora ${editando.nombre} desactivada. Puedes reactivarla desde la lista.`,
      );
    } catch (error) {
      setFalloDesactivar(
        activa
          ? { titulo: 'No pudimos reactivarla', mensaje: mensajeDeError(error) }
          : falloDeDesactivar(
              error,
              usosDeImpresora(
                editando.id,
                consultaDestinos.data ?? [],
                consultaCaja.data?.impresoraCajaId ?? null,
              ),
            ),
      );
      mostrarProblema();
    }
  }

  // --- Acción fija de abajo --------------------------------------------------------------------------
  let pie: ReactNode;
  if (modo.tipo === 'lista') {
    if (impresoras) {
      pie = (
        <Boton variante="principal" bloque icono={IconoMas} onClick={abrirNueva}>
          Agregar impresora
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
          disabled={!!editando && !impresoraCambio(editando, borrador, impresoras ?? [])}
        >
          {modo.tipo === 'nueva' ? 'Crear impresora' : 'Guardar'}
        </Boton>
      </div>
    );
  }

  // --- Pantalla --------------------------------------------------------------------------------------
  let cuerpo: ReactNode;
  if (modo.tipo !== 'lista') {
    const usos = editando
      ? usosDeImpresora(
          editando.id,
          consultaDestinos.data ?? [],
          consultaCaja.data?.impresoraCajaId ?? null,
        )
      : [];
    cuerpo = (
      <FormularioDeImpresora
        formId={ID_FORMULARIO}
        titulo={editando ? editando.nombre : 'Nueva impresora'}
        borrador={borrador}
        errores={errores}
        general={fallo}
        onCambio={cambiar}
        onEnviar={() => void guardar()}
        enfocarNombre={modo.tipo === 'nueva'}
      >
        {editando ? (
          <div className="ui-acciones__separada impresion__grupo">
            {falloDesactivar ? (
              <Aviso tipo="error" titulo={falloDesactivar.titulo}>
                {falloDesactivar.mensaje}
              </Aviso>
            ) : null}
            {editando.activa ? (
              <>
                <p className="texto-ayuda">
                  {usos.length > 0
                    ? `Ahora se usa en ${unirNombres(usos)}. Cambia ese destino antes de desactivarla. `
                    : 'Una impresora desactivada no aparece al elegir destinos y no se borra: puedes reactivarla. '}
                  {editando.pendientes > 0
                    ? `Sus ${editando.pendientes} trabajos pendientes siguen en cola hasta que venzan.`
                    : ''}
                </p>
                <Boton
                  variante="peligro"
                  bloque
                  disabled={guardando}
                  onClick={() => void cambiarActiva(false)}
                >
                  Desactivar impresora
                </Boton>
              </>
            ) : (
              <>
                <p className="texto-ayuda">
                  Está desactivada: no se puede elegir como destino. Sus trabajos pendientes siguen
                  en cola hasta que venzan.
                </p>
                <Boton bloque disabled={guardando} onClick={() => void cambiarActiva(true)}>
                  Reactivar impresora
                </Boton>
              </>
            )}
          </div>
        ) : null}
      </FormularioDeImpresora>
    );
  } else if (consultaImpresoras.isPending) {
    cuerpo = <EsqueletoDeLista etiqueta="Cargando las impresoras" conInicial filas={3} />;
  } else if (consultaImpresoras.isError) {
    cuerpo = (
      <ErrorDeCarga
        titulo="No pudimos cargar las impresoras"
        onReintentar={() => void consultaImpresoras.refetch()}
        reintentando={consultaImpresoras.isFetching}
      >
        {mensajeDeError(consultaImpresoras.error)}
      </ErrorDeCarga>
    );
  } else {
    const activas = lista.filter((i) => i.activa).length;
    cuerpo = (
      <>
        {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
        <section className="impresion__grupo" aria-labelledby={ID_TITULO_LISTA}>
          <h3 className="formulario__titulo" id={ID_TITULO_LISTA} tabIndex={-1}>
            Impresoras
          </h3>
          {lista.length === 0 ? (
            <EstadoVacio icono={IconoImpresora} titulo="Aún no hay impresoras">
              Toca “Agregar impresora” para registrar la de la cocina, la de la barra o la de la
              caja.
            </EstadoVacio>
          ) : (
            <>
              <p className="texto-ayuda" aria-live="polite">
                {activas === 1 ? '1 impresora activa' : `${activas} impresoras activas`}
                {lista.length > activas
                  ? ` · ${lista.length - activas === 1 ? '1 inactiva' : `${lista.length - activas} inactivas`}`
                  : ''}
              </p>
              <ListaDeImpresoras impresoras={lista} onElegir={abrirEditar} />
            </>
          )}
        </section>

        {consultaDestinos.isPending ? (
          <EsqueletoDeLista
            etiqueta="Cargando dónde sale cada estación"
            conInicial={false}
            filas={2}
          />
        ) : consultaDestinos.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar dónde sale cada estación"
            onReintentar={() => void consultaDestinos.refetch()}
            reintentando={consultaDestinos.isFetching}
          >
            {mensajeDeError(consultaDestinos.error)}
          </ErrorDeCarga>
        ) : (
          <DondeSaleCadaEstacion
            sucursalId={sucursalId}
            destinos={consultaDestinos.data}
            impresoras={lista}
            enviar={envio.enviar}
          />
        )}

        {consultaCaja.isPending ? (
          <EsqueletoDeLista etiqueta="Cargando la impresora de caja" conInicial={false} filas={1} />
        ) : consultaCaja.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar la impresora de caja"
            onReintentar={() => void consultaCaja.refetch()}
            reintentando={consultaCaja.isFetching}
          >
            {mensajeDeError(consultaCaja.error)}
          </ErrorDeCarga>
        ) : (
          <ImpresoraDeCaja
            sucursalId={sucursalId}
            impresoraCajaId={consultaCaja.data.impresoraCajaId}
            impresoras={lista}
            enviar={envio.enviar}
          />
        )}
      </>
    );
  }

  return (
    <MarcoDeAjustes actual="impresion" ancho="ancho" {...(pie ? { pie } : {})}>
      <AvisoPendiente pendiente={envio.pendiente} />
      {cuerpo}
    </MarcoDeAjustes>
  );
}
