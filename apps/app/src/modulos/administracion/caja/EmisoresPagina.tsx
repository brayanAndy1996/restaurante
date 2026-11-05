import type { EmisorRespuesta, TasaIgvRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoSeleccion,
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoEmpresa,
  IconoMas,
  IconoSuscripcion,
  TablaResponsiva,
  claseFila,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { fechaLarga, sumarDiasAFecha } from '../../../lib/formato';
import { NOMBRE_DE_REGIMEN } from '../../plataforma/plataforma';
import { MarcoDeAjustes } from '../MarcoDeAjustes';
import {
  claveEmisores,
  claveTasas,
  conTasaGuardada,
  estadoDeTasa,
  falloDeTasa,
  guardarTasa,
  hoyEnLima,
  listarEmisores,
  listarTasas,
  textoDeTasa,
  validarTasa,
  type BorradorDeTasa,
  type EstadoDeFecha,
  type ErroresDeTasa,
} from './cajas';
import './caja.css';

type Modo = { tipo: 'lista' } | { tipo: 'nueva' } | { tipo: 'editar'; desde: string };

const ID_FORMULARIO = 'formulario-de-tasa';
const ID_TITULO_LISTA = 'emisores-tasas';

const ESTADO: Record<EstadoDeFecha, { tono: 'ok' | 'info' | 'neutro'; texto: string }> = {
  VIGENTE: { tono: 'ok', texto: 'Vigente' },
  PROGRAMADA: { tono: 'info', texto: 'Desde una fecha futura' },
  ANTERIOR: { tono: 'neutro', texto: 'Reemplazada' },
};

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
 * Ajustes › Emisores (criterio 117 de 006): la tasa de IGV de cada emisor con su fecha "Desde". Las ventas ya
 * emitidas no se recalculan: una tasa nueva rige desde su fecha. Solo el Administrador.
 */
export function EmisoresPagina() {
  const clientes = useQueryClient();
  const consultaEmisores = useQuery({
    queryKey: claveEmisores,
    queryFn: ({ signal }) => listarEmisores(signal),
  });
  const emisores = consultaEmisores.data;
  const [elegido, setElegido] = useState<string | undefined>(undefined);
  const emisor: EmisorRespuesta | undefined =
    emisores?.find((e) => e.id === elegido) ?? emisores?.[0];
  const usaTasa = emisor !== undefined && emisor.regimen !== 'NUEVO_RUS';

  const consultaTasas = useQuery({
    queryKey: claveTasas(emisor?.id ?? ''),
    queryFn: ({ signal }) => listarTasas(emisor?.id ?? '', signal),
    enabled: usaTasa,
  });
  const tasas = consultaTasas.data;
  // Lo más nuevo arriba: la que rige hoy se encuentra sin buscar.
  const lista = [...(tasas ?? [])].sort((a, b) => b.desde.localeCompare(a.desde));
  const hoy = hoyEnLima();

  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [borrador, setBorrador] = useState<BorradorDeTasa>({ desde: '', tasa: '' });
  const [errores, setErrores] = useState<ErroresDeTasa>({});
  const [fallo, setFallo] = useState<string>();
  const [confirmacion, setConfirmacion] = useState('');

  const editando = modo.tipo === 'editar' ? lista.find((t) => t.desde === modo.desde) : undefined;
  useEffect(() => {
    if (modo.tipo === 'editar' && tasas && !editando) setModo({ tipo: 'lista' });
  }, [modo, tasas, editando]);

  const clavePantalla = modo.tipo === 'editar' ? modo.desde : modo.tipo;
  useEffect(() => {
    const marco = document.getElementById('contenido');
    if (marco) marco.scrollTop = 0;
  }, [clavePantalla]);

  // --- Escritura: sin red no se pierde, queda "Pendiente de envío" y sale sola -----------------------
  const envio = useEnvioPendiente();
  const guardarM = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (datos: { emisorId: string; desde: string; tasa: string }) =>
      envio.enviar((extra) => guardarTasa(datos.emisorId, datos.desde, datos.tasa, extra)),
    onSuccess: (guardada, datos) => {
      clientes.setQueryData<TasaIgvRespuesta[]>(claveTasas(datos.emisorId), (anterior) =>
        conTasaGuardada(anterior ?? [], guardada),
      );
    },
  });
  const guardando = guardarM.isPending;

  // --- Navegación ------------------------------------------------------------------------------------
  function limpiar() {
    setConfirmacion('');
    setErrores({});
    setFallo(undefined);
  }

  function volver() {
    limpiar();
    setModo({ tipo: 'lista' });
    requestAnimationFrame(() => document.getElementById(ID_TITULO_LISTA)?.focus());
  }

  function abrirNueva() {
    if (guardando) return;
    limpiar();
    // La primera rige desde hoy; las siguientes, desde mañana (hoy ya pudo haber ventas con la anterior).
    setBorrador({ desde: lista.length === 0 ? hoy : sumarDiasAFecha(hoy, 1), tasa: '' });
    setModo({ tipo: 'nueva' });
  }

  function abrirEditar(desde: string) {
    const tasa = lista.find((t) => t.desde === desde);
    if (!tasa || guardando) return;
    limpiar();
    setBorrador({ desde: tasa.desde, tasa: tasa.tasa });
    setModo({ tipo: 'editar', desde });
  }

  function cambiar(parcial: Partial<BorradorDeTasa>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setErrores((e) => {
      const siguiente = { ...e };
      for (const campo of Object.keys(parcial) as (keyof BorradorDeTasa)[]) delete siguiente[campo];
      return siguiente;
    });
    setFallo(undefined);
  }

  async function guardar() {
    if (guardando || modo.tipo === 'lista' || !emisor) return;
    const resultado = validarTasa(borrador, lista, modo.tipo === 'editar');
    if (!resultado.ok) {
      setErrores(resultado.errores);
      return mostrarProblema();
    }
    setErrores({});
    setFallo(undefined);
    // Sin cambios no se envía nada: la API no deja rastro y la persona vuelve a la lista.
    if (editando && editando.tasa === resultado.tasa) return volver();
    try {
      await guardarM.mutateAsync({
        emisorId: emisor.id,
        desde: resultado.desde,
        tasa: resultado.tasa,
      });
      const nueva = modo.tipo === 'nueva';
      volver();
      setConfirmacion(
        nueva
          ? `Tasa de ${textoDeTasa(resultado.tasa)} guardada desde el ${fechaLarga(resultado.desde)}.`
          : `Tasa desde el ${fechaLarga(resultado.desde)} cambiada a ${textoDeTasa(resultado.tasa)}.`,
      );
    } catch (error) {
      const traducido = falloDeTasa(error);
      // Al cambiar una tasa existente, la fecha no se puede tocar: el choque se dice como aviso del formulario.
      if (modo.tipo === 'editar' && traducido.campos.desde) {
        setFallo(traducido.campos.desde);
      } else {
        setErrores(traducido.campos);
        setFallo(traducido.general);
      }
      mostrarProblema();
    }
  }

  // --- Acción fija de abajo --------------------------------------------------------------------------
  let pie: ReactNode;
  if (modo.tipo === 'lista') {
    if (usaTasa && tasas) {
      pie = (
        <Boton variante="principal" bloque icono={IconoMas} onClick={abrirNueva}>
          Agregar tasa
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
        >
          {modo.tipo === 'nueva' ? 'Guardar tasa' : 'Guardar'}
        </Boton>
      </div>
    );
  }

  // --- Pantalla --------------------------------------------------------------------------------------
  let cuerpo: ReactNode;
  if (consultaEmisores.isPending) {
    cuerpo = <EsqueletoDeLista etiqueta="Cargando los emisores" conInicial filas={2} />;
  } else if (consultaEmisores.isError) {
    cuerpo = (
      <ErrorDeCarga
        titulo="No pudimos cargar los emisores"
        onReintentar={() => void consultaEmisores.refetch()}
        reintentando={consultaEmisores.isFetching}
      >
        {mensajeDeError(consultaEmisores.error)}
      </ErrorDeCarga>
    );
  } else if (!emisor || !emisores) {
    cuerpo = (
      <EstadoVacio icono={IconoEmpresa} titulo="Aún no hay emisores">
        Cuando se registre el RUC de tu empresa, aquí pondrás su tasa de IGV.
      </EstadoVacio>
    );
  } else if (modo.tipo !== 'lista') {
    cuerpo = (
      <form
        id={ID_FORMULARIO}
        className="formulario caja__formulario"
        onSubmit={(e) => {
          e.preventDefault();
          void guardar();
        }}
        noValidate
        aria-labelledby={`${ID_FORMULARIO}-titulo`}
      >
        <h3 className="formulario__titulo" id={`${ID_FORMULARIO}-titulo`}>
          {editando ? `Tasa desde el ${fechaLarga(editando.desde)}` : 'Nueva tasa de IGV'}
        </h3>
        <p className="texto-ayuda">{`${emisor.razonSocial} · RUC ${emisor.ruc}`}</p>
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos guardar la tasa">
            {fallo}
          </Aviso>
        ) : null}
        <CampoTexto
          etiqueta="Desde"
          type="date"
          value={borrador.desde}
          onChange={(e) => cambiar({ desde: e.target.value })}
          error={errores.desde}
          readOnly={!!editando}
          ayuda={
            editando
              ? 'La fecha no se cambia. Para otra fecha, agrega una tasa nueva.'
              : 'El primer día en que rige. Las ventas ya emitidas no cambian.'
          }
        />
        <CampoTexto
          etiqueta="Tasa de IGV (%)"
          value={borrador.tasa}
          onChange={(e) => cambiar({ tasa: e.target.value })}
          error={errores.tasa}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={5}
          placeholder="18"
          ayuda="El porcentaje que te indicó tu contador, por ejemplo 18 o 10.5."
        />
      </form>
    );
  } else {
    cuerpo = (
      <>
        {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
        {emisores.length > 1 ? (
          <CampoSeleccion
            etiqueta="Emisor"
            value={emisor.id}
            onChange={(e) => setElegido(e.target.value)}
          >
            {emisores.map((e) => (
              <option key={e.id} value={e.id}>
                {`${e.razonSocial} · RUC ${e.ruc}`}
              </option>
            ))}
          </CampoSeleccion>
        ) : null}
        <section className="caja__emisor" aria-label="Datos del emisor">
          <b>{emisor.razonSocial}</b>
          <span className="texto-ayuda">{`RUC ${emisor.ruc} · ${NOMBRE_DE_REGIMEN[emisor.regimen]}`}</span>
        </section>
        {!usaTasa ? (
          <Aviso tipo="info" titulo="Este emisor no usa tasa de IGV">
            En el Nuevo RUS el precio de la boleta es el total, sin IGV aparte.
          </Aviso>
        ) : (
          <section className="caja__grupo" aria-labelledby={ID_TITULO_LISTA}>
            <h3 className="formulario__titulo" id={ID_TITULO_LISTA} tabIndex={-1}>
              Tasa de IGV
            </h3>
            {consultaTasas.isPending ? (
              <EsqueletoDeLista etiqueta="Cargando las tasas" conInicial={false} filas={2} />
            ) : consultaTasas.isError ? (
              <ErrorDeCarga
                titulo="No pudimos cargar las tasas"
                onReintentar={() => void consultaTasas.refetch()}
                reintentando={consultaTasas.isFetching}
              >
                {mensajeDeError(consultaTasas.error)}
              </ErrorDeCarga>
            ) : lista.length === 0 ? (
              <EstadoVacio icono={IconoSuscripcion} titulo="Aún no hay tasa de IGV">
                Sin una tasa no se puede cobrar. Toca “Agregar tasa” y escribe el porcentaje que te
                indicó tu contador.
              </EstadoVacio>
            ) : (
              <>
                <p className="texto-ayuda">
                  Cada tasa rige desde su fecha. Las ventas ya emitidas no se recalculan.
                </p>
                <TablaResponsiva
                  etiqueta="Tasas de IGV"
                  filas={lista}
                  clave={(t) => t.desde}
                  apagada={(t) => estadoDeTasa(t, lista, hoy) === 'ANTERIOR'}
                  filaEnLista={(t) => (
                    <button
                      type="button"
                      className={claseFila(estadoDeTasa(t, lista, hoy) === 'ANTERIOR')}
                      onClick={() => abrirEditar(t.desde)}
                    >
                      <ContenidoDeFila
                        titulo={<span className="caja__tasa">{textoDeTasa(t.tasa)}</span>}
                        ayuda={`Desde el ${fechaLarga(t.desde)}`}
                        derecha={<Icono icono={IconoDerecha} />}
                        extra={<EtiquetaDeTasa estado={estadoDeTasa(t, lista, hoy)} />}
                      />
                    </button>
                  )}
                  columnas={[
                    {
                      id: 'desde',
                      encabezado: 'Desde',
                      sinSaltos: true,
                      celda: (t) => fechaLarga(t.desde),
                    },
                    {
                      id: 'tasa',
                      encabezado: 'Tasa',
                      alinear: 'derecha',
                      sinSaltos: true,
                      celda: (t) => <b className="caja__tasa">{textoDeTasa(t.tasa)}</b>,
                    },
                    {
                      id: 'estado',
                      encabezado: 'Estado',
                      celda: (t) => <EtiquetaDeTasa estado={estadoDeTasa(t, lista, hoy)} />,
                    },
                    {
                      id: 'acciones',
                      encabezado: 'Acciones',
                      encabezadoOculto: true,
                      alinear: 'derecha',
                      sinSaltos: true,
                      celda: (t) => (
                        <Boton onClick={() => abrirEditar(t.desde)}>
                          Cambiar{' '}
                          <span className="ui-solo-lectores">{`la tasa desde el ${fechaLarga(t.desde)}`}</span>
                        </Boton>
                      ),
                    },
                  ]}
                />
              </>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <MarcoDeAjustes actual="emisores" ancho="ancho" {...(pie ? { pie } : {})}>
      <AvisoPendiente pendiente={envio.pendiente} />
      {cuerpo}
    </MarcoDeAjustes>
  );
}

function EtiquetaDeTasa({ estado }: { estado: EstadoDeFecha }) {
  const { tono, texto } = ESTADO[estado];
  return <EtiquetaDeEstado tono={tono}>{texto}</EtiquetaDeEstado>;
}
