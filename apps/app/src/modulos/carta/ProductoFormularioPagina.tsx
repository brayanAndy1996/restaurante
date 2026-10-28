import type { ProductoRespuesta, SeQuita, UsadoEn } from '@restaurante/contratos';
import { AFECTACIONES_IGV, TIPOS_CONTROL_STOCK, type TipoProducto } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  Casilla,
  CampoAreaTexto,
  CampoMonto,
  CampoSeleccion,
  CampoTexto,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Interruptor,
  OpcionesConAyuda,
  Plegable,
  claseBoton,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { CLAVE_DISPONIBILIDAD } from '../disponibilidad/disponibilidad';
import {
  CLAVES,
  ETIQUETA_DE_CONTROL,
  crearProducto,
  listarEstaciones,
  listarFamilias,
  modificarProducto,
  obtenerProducto,
  puedeAjustarSucursal,
} from './carta';
import { ComponentesDelCombo } from './ComponentesDelCombo';
import { FotoDeProducto } from './FotoDeProducto';
import { GruposDelProducto } from './GruposDelProducto';
import { PrecioPorSucursal } from './PrecioPorSucursal';
import {
  AVISO_MENU_SIN_ARMAR,
  ETIQUETA_DE_AFECTACION,
  SIN_ESTACION,
  avisosDeCambioDeTipo,
  cambiarDeTipo,
  cambiosDelProducto,
  entradaDeCreacion,
  formularioDeProducto,
  formularioVacio,
  frasesDeSeQuita,
  hayCambios,
  validarProducto,
  type CampoDelProducto,
  type ErroresDelProducto,
  type EstadoDelProducto,
} from './producto-form';
import { SelectorDeTipo } from './SelectorDeTipo';
import { definicionDeTipo, tipoEnFrase } from './tipos';
import { VistaPreviaDeCombo } from './VistaPreviaDeCombo';

const AYUDA_DE_CONTROL: Record<(typeof TIPOS_CONTROL_STOCK)[number], string> = {
  UNIDADES:
    'Cuentas cuántas unidades hay y cada venta resta una. Para gaseosas, cervezas o postres.',
  PORCIONES:
    'Cargas cuántas porciones salen hoy y cada venta resta una. Para platos que se acaban, como el pollo.',
  SIN_CONTROL: 'No llevas stock de este producto. Tú marcas "agotado" cuando se acaba.',
};

const OPCIONES_DE_CONTROL = TIPOS_CONTROL_STOCK.map((valor) => ({
  valor,
  titulo: ETIQUETA_DE_CONTROL[valor],
  ayuda: AYUDA_DE_CONTROL[valor],
}));

const CAMPOS_CON_ERROR: readonly CampoDelProducto[] = [
  'nombre',
  'descripcion',
  'familiaId',
  'precio',
  'estacionId',
  'tipoControlStock',
  'gruposModificadores',
  'componentes',
  'noDisponibleEn',
];

function comoErrorApi(e: unknown): ErrorApi {
  return e instanceof ErrorApi
    ? e
    : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
}

/** Alta de producto. */
export function ProductoNuevoPagina() {
  return <CargaDelFormulario modo="crear" />;
}

/** Edición de un producto existente: carga el producto y muestra el mismo formulario. */
export function ProductoEditarPagina() {
  const { id = '' } = useParams();
  return <CargaDelFormulario modo="editar" id={id} />;
}

const ATRAS = { a: '/carta', etiqueta: 'Carta' } as const;

/** Carga lo que el formulario necesita (familias, estaciones y, al editar, el producto) y lo muestra. */
function CargaDelFormulario({ modo, id }: { modo: 'crear' | 'editar'; id?: string }) {
  const producto = useQuery({
    queryKey: CLAVES.producto(id ?? ''),
    queryFn: ({ signal }) => obtenerProducto(id ?? '', signal),
    enabled: modo === 'editar',
  });
  const familias = useQuery({
    queryKey: CLAVES.familias,
    queryFn: ({ signal }) => listarFamilias(signal),
  });
  const estaciones = useQuery({
    queryKey: CLAVES.estaciones,
    queryFn: ({ signal }) => listarEstaciones(signal),
  });

  const titulo = modo === 'crear' ? 'Nuevo producto' : 'Producto';
  if (producto.isPending && modo === 'editar') {
    return (
      <Pagina titulo={titulo} atras={ATRAS}>
        <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando producto" />
      </Pagina>
    );
  }
  if (producto.isError && modo === 'editar') {
    const noExiste =
      producto.error instanceof ErrorApi && producto.error.codigo === 'NO_ENCONTRADO';
    return (
      <Pagina titulo={titulo} atras={ATRAS}>
        <ErrorDeCarga
          titulo={noExiste ? 'No encontramos este producto' : 'No pudimos cargar el producto'}
          onReintentar={() => void producto.refetch()}
          reintentando={producto.isFetching}
        >
          {noExiste ? 'Puede que ya no exista. Vuelve a la carta.' : mensajeDeError(producto.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  if (familias.isPending || estaciones.isPending) {
    return (
      <Pagina titulo={titulo} atras={ATRAS}>
        <EsqueletoDeLista filas={4} conInicial={false} etiqueta="Cargando el formulario" />
      </Pagina>
    );
  }
  if (familias.isError || estaciones.isError) {
    const falla = familias.isError ? familias : estaciones;
    return (
      <Pagina titulo={titulo} atras={ATRAS}>
        <ErrorDeCarga
          titulo="No pudimos cargar el formulario"
          onReintentar={() => {
            void familias.refetch();
            void estaciones.refetch();
          }}
          reintentando={familias.isFetching || estaciones.isFetching}
        >
          {mensajeDeError(falla.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  return (
    <FormularioDeProducto
      key={producto.data?.id ?? 'nuevo'}
      modo={modo}
      {...(producto.data ? { original: producto.data } : {})}
      familias={familias.data.filter((f) => f.activa || f.id === producto.data?.familiaId)}
      estaciones={estaciones.data.filter((e) => e.activa || e.id === producto.data?.estacionId)}
    />
  );
}

interface PropsFormulario {
  modo: 'crear' | 'editar';
  original?: ProductoRespuesta;
  familias: { id: string; nombre: string; activa: boolean }[];
  estaciones: { id: string; nombre: string; activa: boolean }[];
}

/** Lo que el 409 `CONFIRMACION_REQUERIDA` pide confirmar: qué se quita y a qué tipo se pasa. */
interface ConfirmacionDeTipo {
  seQuita: SeQuita;
  tipo: TipoProducto;
}

/** Lo que el 409 `EN_USO` dice: dónde se usa el producto y a qué tipo se quiso pasar. */
interface UsoQueImpide {
  usadoEn: UsadoEn;
  tipo: TipoProducto;
}

function FormularioDeProducto({ modo, original, familias, estaciones }: PropsFormulario) {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const puedeArmarMenu = usePermiso('GESTIONAR_DISPONIBILIDAD') === 'permitido';

  const [guardadoPrevio, setGuardadoPrevio] = useState<ProductoRespuesta | undefined>(original);
  const [estado, setEstado] = useState<EstadoDelProducto>(() =>
    original ? formularioDeProducto(original) : formularioVacio(sesion.sucursales.map((s) => s.id)),
  );
  const [errores, setErrores] = useState<ErroresDelProducto>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tributarioAbierto, setTributarioAbierto] = useState(false);
  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);
  const [porConfirmar, setPorConfirmar] = useState<ConfirmacionDeTipo | null>(null);
  const [falloDeConfirmacion, setFalloDeConfirmacion] = useState<string | null>(null);
  const [usoQueImpide, setUsoQueImpide] = useState<UsoQueImpide | null>(null);

  // El botón de guardar está abajo y los avisos arriba: al aparecer uno, se trae a la vista.
  useEffect(() => {
    if (usoQueImpide || fallo) {
      document.getElementById('aviso-de-guardado')?.scrollIntoView?.({ block: 'center' });
    }
  }, [usoQueImpide, fallo]);

  const recienCreado = Boolean((ubicacion.state as { creado?: boolean } | null)?.creado);
  const definicion = definicionDeTipo(estado.tipo);
  const cambios = guardadoPrevio ? cambiosDelProducto(guardadoPrevio, estado) : {};
  const sinCambios = modo === 'editar' && !hayCambios(cambios);
  const familiasActivas = familias.filter((f) => f.activa || f.id === estado.familiaId);
  const nombreDeEstacion =
    (guardadoPrevio?.estacionId
      ? estaciones.find((e) => e.id === guardadoPrevio.estacionId)?.nombre
      : undefined) ?? null;
  const avisosDeTipo =
    modo === 'editar' && guardadoPrevio
      ? avisosDeCambioDeTipo(guardadoPrevio, estado.tipo, nombreDeEstacion)
      : modo === 'crear' && estado.tipo === 'MENU_DEL_DIA'
        ? [AVISO_MENU_SIN_ARMAR]
        : [];

  function cambiar(parcial: Partial<EstadoDelProducto>) {
    setEstado((e) => ({ ...e, ...parcial }));
    setGuardado(null);
  }

  function elegirTipo(tipo: TipoProducto) {
    setEstado((e) => cambiarDeTipo(e, tipo, guardadoPrevio));
    setGuardado(null);
    setUsoQueImpide(null);
    // Los errores del tipo anterior (la estación, los componentes) ya no corresponden.
    setErrores({});
  }

  function quitarError(campo: CampoDelProducto) {
    setErrores((e) => {
      if (!(campo in e)) return e;
      const { [campo]: _quitado, ...resto } = e;
      return resto;
    });
  }

  function refrescarListas() {
    void clientes.invalidateQueries({ queryKey: CLAVES.productos });
    void clientes.invalidateQueries({ queryKey: CLAVES.familias });
    void clientes.invalidateQueries({ queryKey: CLAVES.estaciones });
    // Cuántos productos usa cada grupo cambia al asignarlo o quitarlo.
    void clientes.invalidateQueries({ queryKey: CLAVES.grupos });
    // Un menú que cambia de tipo o de grupos cambia lo que se arma en Disponibilidad.
    void clientes.invalidateQueries({ queryKey: CLAVE_DISPONIBILIDAD });
  }

  function mostrarFalloDeLaApi(e: unknown) {
    const error = comoErrorApi(e);
    const campos = erroresPorCampo(error);
    if (error.codigo === 'CONFLICTO') {
      if ('seVendeSolo' in campos) {
        // Criterio 10d: dejar de venderse solo con precio propio en alguna sucursal.
        setFallo(
          `${error.message} Quita primero esos precios en «Precio por sucursal» y vuelve a guardar.`,
        );
      } else if (modo === 'crear' && error.reintentada) {
        setFallo(
          'La conexión se cortó mientras se guardaba y es posible que el producto ya se haya creado. Revisa la carta antes de intentarlo otra vez.',
        );
      } else {
        setErrores({ nombre: 'Ya tienes un producto con ese nombre. Usa otro.' });
      }
      return;
    }
    if (error.codigo === 'REFERENCIA_INVALIDA' || error.codigo === 'DATOS_INVALIDOS') {
      const porCampo: ErroresDelProducto = {};
      for (const [campo, mensaje] of Object.entries(campos)) {
        const raiz = campo.split('.')[0] as CampoDelProducto;
        if (CAMPOS_CON_ERROR.includes(raiz)) {
          porCampo[raiz] =
            error.codigo === 'REFERENCIA_INVALIDA'
              ? 'Esto ya no está disponible. Elige otra opción.'
              : mensajeDeCampo(mensaje);
        }
      }
      setErrores(porCampo);
      setFallo(mensajeDeError(error));
      return;
    }
    setFallo(
      mensajeDeError(error, {
        PROHIBIDO:
          modo === 'crear'
            ? 'No puedes dejar el producto sin ofrecer en una sucursal donde no eres Cajero. Déjala marcada.'
            : 'No tienes permiso para cambiar este producto.',
      }),
    );
  }

  /**
   * Guarda los cambios de un producto existente. Con `confirmarPerdida` repite el mismo `PATCH` que la API
   * pidió confirmar (criterio 10b). Devuelve `true` si se guardó.
   */
  async function guardarEdicion(confirmarPerdida: boolean): Promise<boolean> {
    if (!guardadoPrevio) return false;
    const cuerpo = confirmarPerdida ? { ...cambios, confirmarPerdida: true } : cambios;
    const tipoAnterior = guardadoPrevio.tipo;
    try {
      const actualizado = await envio.enviar((extra) =>
        modificarProducto(guardadoPrevio.id, cuerpo, extra),
      );
      clientes.setQueryData(CLAVES.producto(actualizado.id), actualizado);
      refrescarListas();
      // El precio efectivo de las sucursales sin precio propio depende del precio de la empresa.
      void clientes.invalidateQueries({ queryKey: CLAVES.sucursalesDeProducto(actualizado.id) });
      if (!envio.sigueMontada()) return true;
      setGuardadoPrevio(actualizado);
      setEstado(formularioDeProducto(actualizado));
      setUsoQueImpide(null);
      setPorConfirmar(null);
      setGuardado(
        actualizado.tipo === tipoAnterior
          ? 'Ya se ven en la carta de todas las sucursales.'
          : `Ahora es ${tipoEnFrase(actualizado.tipo)}. Ya se ve así en la carta de todas las sucursales.${
              actualizado.tipo === 'MENU_DEL_DIA' ? ` ${AVISO_MENU_SIN_ARMAR}` : ''
            }`,
      );
      return true;
    } catch (e) {
      if (!envio.sigueMontada()) return false;
      const error = comoErrorApi(e);
      if (error.codigo === 'CONFIRMACION_REQUERIDA' && error.seQuita) {
        // Primera vez, o apareció algo más desde que se mostró la lista: se vuelve a pedir confirmar.
        setPorConfirmar({ seQuita: error.seQuita, tipo: estado.tipo });
        setFalloDeConfirmacion(null);
        return false;
      }
      if (error.codigo === 'EN_USO' && error.usadoEn) {
        setPorConfirmar(null);
        setUsoQueImpide({ usadoEn: error.usadoEn, tipo: estado.tipo });
        return false;
      }
      if (confirmarPerdida) setPorConfirmar(null);
      mostrarFalloDeLaApi(error);
      return false;
    }
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = validarProducto(estado);
    setErrores(nuevos);
    setFallo(null);
    setUsoQueImpide(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      if (modo === 'crear') {
        try {
          const creado = await envio.enviar((extra) =>
            crearProducto(entradaDeCreacion(estado), extra),
          );
          clientes.setQueryData(CLAVES.producto(creado.id), creado);
          refrescarListas();
          if (envio.sigueMontada()) {
            navegar(`/carta/productos/${creado.id}`, { replace: true, state: { creado: true } });
          }
        } catch (e) {
          if (envio.sigueMontada()) mostrarFalloDeLaApi(e);
        }
      } else {
        await guardarEdicion(false);
      }
    } finally {
      if (envio.sigueMontada()) setEnviando(false);
    }
  }

  async function confirmarCambioDeTipo() {
    if (enviando) return;
    setEnviando(true);
    setFalloDeConfirmacion(null);
    try {
      await guardarEdicion(true);
    } finally {
      if (envio.sigueMontada()) setEnviando(false);
    }
  }

  async function cambiarActivo(activo: boolean) {
    if (!guardadoPrevio) return;
    setCambiandoActivo(true);
    setFallo(null);
    try {
      const actualizado = await envio.enviar((extra) =>
        modificarProducto(guardadoPrevio.id, { activo }, extra),
      );
      clientes.setQueryData(CLAVES.producto(actualizado.id), actualizado);
      refrescarListas();
      setGuardadoPrevio(actualizado);
      setGuardado(null);
    } catch (e) {
      setFallo(mensajeDeError(e, { PROHIBIDO: 'No tienes permiso para cambiar este producto.' }));
    } finally {
      setCambiandoActivo(false);
      setConfirmandoDesactivar(false);
    }
  }

  function alCambiarFoto(fotoUrl: string | null) {
    if (!guardadoPrevio) return;
    const actualizado = { ...guardadoPrevio, fotoUrl };
    clientes.setQueryData(CLAVES.producto(actualizado.id), actualizado);
    void clientes.invalidateQueries({ queryKey: CLAVES.productos });
    setGuardadoPrevio(actualizado);
  }

  const titulo = modo === 'crear' ? 'Nuevo producto' : (guardadoPrevio?.nombre ?? 'Producto');
  const sucursales = sesion.sucursales.map((s) => ({
    ...s,
    editable: puedeAjustarSucursal(sesion, s),
  }));
  const usadoEn = guardadoPrevio?.usadoEn;
  const enUso = (usadoEn?.combos.length ?? 0) + (usadoEn?.modificadores.length ?? 0);
  const esCombo = definicion.campos.componentes;
  const tipoGuardado = guardadoPrevio?.tipo;
  const frasesDeConfirmacion = porConfirmar ? frasesDeSeQuita(porConfirmar.seQuita) : [];

  return (
    <Pagina
      titulo={titulo}
      atras={ATRAS}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-producto"
          cargando={enviando && !porConfirmar}
          textoCargando="Guardando…"
          disabled={sinCambios}
        >
          {modo === 'crear' ? 'Crear producto' : 'Guardar cambios'}
        </Boton>
      }
    >
      {modo === 'editar' && guardadoPrevio && !guardadoPrevio.activo ? (
        <div className="etiquetas">
          <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado>
        </div>
      ) : null}

      {recienCreado && modo === 'editar' ? (
        <Aviso tipo="ok" titulo="Producto creado">
          <p>Agrega su foto si quieres, o sigue con otro producto.</p>
          <p className="carta__enlaces">
            <Link to="/carta/productos/nuevo" className="enlace-texto">
              Crear otro producto
            </Link>
            <Link to="/carta" className="enlace-texto">
              Volver a la carta
            </Link>
          </p>
        </Aviso>
      ) : null}
      {guardado ? (
        <Aviso tipo="ok" titulo="Cambios guardados">
          {guardado}
        </Aviso>
      ) : null}
      <AvisoPendiente pendiente={envio.pendiente} />
      <div id="aviso-de-guardado" className="avisos-de-guardado">
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos guardar">
            {fallo}
          </Aviso>
        ) : null}
        {usoQueImpide ? (
          <AvisoDeUso
            uso={usoQueImpide}
            alVolver={() => elegirTipo(tipoGuardado ?? 'SIMPLE')}
            tipoGuardado={tipoGuardado}
          />
        ) : null}
      </div>
      {avisosDeTipo.length > 0 ? (
        <Aviso
          tipo={modo === 'crear' ? 'info' : 'alerta'}
          titulo={
            modo === 'crear'
              ? 'Un menú del día nace sin armar'
              : `Al guardar, pasará a ser ${tipoEnFrase(estado.tipo)}`
          }
        >
          <ul className="carta__usos">
            {avisosDeTipo.map((aviso) => (
              <li key={aviso}>{aviso}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      <form
        id="formulario-producto"
        className="formulario formulario--secciones"
        onSubmit={(e) => void enviar(e)}
        noValidate
      >
        <section className="seccion" aria-labelledby="producto-datos">
          <h2 className="formulario__titulo" id="producto-datos">
            Datos
          </h2>
          <SelectorDeTipo valor={estado.tipo} onCambio={elegirTipo} />
          <CampoTexto
            etiqueta="Nombre"
            value={estado.nombre}
            onChange={(e) => {
              cambiar({ nombre: e.target.value });
              quitarError('nombre');
            }}
            error={errores.nombre}
            autoComplete="off"
            enterKeyHint="next"
          />
          <CampoAreaTexto
            etiqueta="Descripción"
            opcional
            value={estado.descripcion}
            onChange={(e) => {
              cambiar({ descripcion: e.target.value });
              quitarError('descripcion');
            }}
            error={errores.descripcion}
            ayuda="Se ve en la carta web."
            rows={3}
          />
          <CampoSeleccion
            etiqueta="Familia"
            value={estado.familiaId}
            onChange={(e) => {
              cambiar({ familiaId: e.target.value });
              quitarError('familiaId');
            }}
            error={errores.familiaId}
          >
            <option value="" disabled>
              Elige una familia
            </option>
            {familiasActivas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
                {f.activa ? '' : ' (inactiva)'}
              </option>
            ))}
          </CampoSeleccion>
          {familiasActivas.length === 0 ? (
            <Aviso tipo="alerta" titulo="Primero crea una familia">
              Cada producto va en una familia, por ejemplo Entradas o Bebidas.{' '}
              <Link to="/carta?ver=familias" className="enlace-texto">
                Crear una familia
              </Link>
            </Aviso>
          ) : null}
        </section>

        <section className="seccion" aria-labelledby="producto-precio">
          <h2 className="formulario__titulo" id="producto-precio">
            Precio
          </h2>
          {definicion.campos.seVendeSolo ? (
            <Interruptor
              etiqueta="Se vende solo"
              ayuda={
                estado.seVendeSolo
                  ? 'Aparece en el comandero y en la carta web con su precio.'
                  : 'No lleva precio ni aparece para vender: solo se usa dentro de un combo o como opción.'
              }
              marcado={estado.seVendeSolo}
              onCambio={(seVendeSolo) => {
                cambiar({ seVendeSolo });
                quitarError('precio');
              }}
            />
          ) : null}
          {!definicion.campos.seVendeSolo || estado.seVendeSolo ? (
            <CampoMonto
              etiqueta={esCombo ? 'Precio base con IGV' : 'Precio con IGV'}
              value={estado.precio}
              onValor={(precio) => {
                cambiar({ precio });
                quitarError('precio');
              }}
              error={errores.precio}
              ayuda={
                esCombo
                  ? 'Lo que paga el cliente por el combo. Las opciones con recargo se suman a este precio. El IGV ya está incluido.'
                  : 'Lo que paga el cliente. El IGV ya está incluido.'
              }
            />
          ) : null}
        </section>

        <section className="seccion" aria-labelledby="producto-cocina">
          <h2 className="formulario__titulo" id="producto-cocina">
            {definicion.campos.estacion ? 'Cocina y stock' : 'Stock'}
          </h2>
          {definicion.campos.estacion ? (
            <CampoSeleccion
              etiqueta="Estación"
              value={estado.estacionId}
              onChange={(e) => {
                cambiar({ estacionId: e.target.value });
                quitarError('estacionId');
              }}
              error={errores.estacionId}
              ayuda="Dónde se prepara. Con una estación, la comanda le llega a ella."
            >
              <option value="" disabled>
                Elige una estación
              </option>
              <option value={SIN_ESTACION}>Ninguna (no va a cocina ni a barra)</option>
              {estaciones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.activa ? '' : ' (inactiva)'}
                </option>
              ))}
            </CampoSeleccion>
          ) : (
            <p className="texto-ayuda">
              Un {tipoEnFrase(estado.tipo)} no tiene estación propia: cada componente y cada opción
              va a la suya.
            </p>
          )}
          <OpcionesConAyuda
            etiqueta="Control de stock"
            opciones={OPCIONES_DE_CONTROL}
            valor={estado.tipoControlStock}
            onCambio={(tipoControlStock) => {
              cambiar({ tipoControlStock });
              quitarError('tipoControlStock');
            }}
            error={errores.tipoControlStock}
          />
        </section>
      </form>

      <div className="formulario formulario--secciones formulario--continuacion">
        {definicion.campos.componentes &&
        (estado.tipo === 'COMBO' || estado.tipo === 'MENU_DEL_DIA') ? (
          <ComponentesDelCombo
            tipo={estado.tipo}
            productoId={guardadoPrevio?.id}
            valor={estado.componentes}
            onCambio={(componentes) => {
              cambiar({ componentes });
              quitarError('componentes');
            }}
            error={errores.componentes}
          />
        ) : null}

        <GruposDelProducto
          tipo={estado.tipo}
          productoId={guardadoPrevio?.id}
          valor={estado.grupos}
          onCambio={(grupos) => {
            cambiar({ grupos });
            quitarError('gruposModificadores');
            quitarError('componentes');
          }}
          error={errores.gruposModificadores}
        />

        {esCombo ? <VistaPreviaDeCombo precio={estado.precio} grupos={estado.grupos} /> : null}

        <Plegable
          titulo="Datos tributarios"
          resumen={`${ETIQUETA_DE_AFECTACION[estado.afectacionIgv]} · ${
            estado.aplicaIcbper ? 'con ICBPER' : 'sin ICBPER'
          }`}
          abierto={tributarioAbierto}
          onCambio={setTributarioAbierto}
        >
          <CampoSeleccion
            etiqueta="Afectación al IGV"
            value={estado.afectacionIgv}
            onChange={(e) =>
              cambiar({ afectacionIgv: e.target.value as EstadoDelProducto['afectacionIgv'] })
            }
            ayuda="Casi todo es gravado. Cámbialo solo si tu contador te lo indicó."
          >
            {AFECTACIONES_IGV.map((a) => (
              <option key={a} value={a}>
                {ETIQUETA_DE_AFECTACION[a]}
              </option>
            ))}
          </CampoSeleccion>
          <Interruptor
            etiqueta="Aplica ICBPER"
            ayuda="Solo para bolsas de plástico, que llevan el impuesto a las bolsas plásticas."
            marcado={estado.aplicaIcbper}
            onCambio={(aplicaIcbper) => cambiar({ aplicaIcbper })}
          />
        </Plegable>

        {modo === 'crear' && sucursales.length > 1 ? (
          <section className="seccion" aria-labelledby="producto-disponible">
            <h2 className="formulario__titulo" id="producto-disponible">
              Disponible en
            </h2>
            <p className="texto-ayuda">
              El producto nace disponible en las sucursales marcadas. El resto de la carta es de
              toda la empresa.
            </p>
            <div className="carta__casillas">
              {sucursales.map((s) => (
                <Casilla
                  key={s.id}
                  etiqueta={s.nombre}
                  marcada={s.editable ? (estado.disponibleEn[s.id] ?? true) : true}
                  bloqueada={!s.editable}
                  ayuda={
                    s.editable
                      ? undefined
                      : 'Solo lo cambia el Administrador o un Cajero de esta sucursal.'
                  }
                  onCambio={(marcada) =>
                    cambiar({ disponibleEn: { ...estado.disponibleEn, [s.id]: marcada } })
                  }
                />
              ))}
            </div>
            {errores.noDisponibleEn ? (
              <p className="ui-campo__mensaje" role="alert">
                {errores.noDisponibleEn}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {modo === 'editar' && guardadoPrevio ? (
        <>
          {guardadoPrevio.tipo === 'MENU_DEL_DIA' && puedeArmarMenu ? (
            <section className="seccion" aria-labelledby="producto-menu">
              <h2 className="formulario__titulo" id="producto-menu">
                Menú de cada día
              </h2>
              <p className="texto-ayuda">
                Cada día, en cada sucursal, se elige cuáles de sus opciones se ofrecen.
              </p>
              <Link to="/disponibilidad?ver=menu" className={claseBoton('secundario', true)}>
                Armar el menú del día
              </Link>
            </section>
          ) : null}

          <section className="seccion" aria-labelledby="producto-foto">
            <h2 className="formulario__titulo" id="producto-foto">
              Foto
            </h2>
            <FotoDeProducto
              productoId={guardadoPrevio.id}
              nombre={guardadoPrevio.nombre}
              fotoUrl={guardadoPrevio.fotoUrl}
              onCambio={alCambiarFoto}
            />
          </section>

          <PrecioPorSucursal
            productoId={guardadoPrevio.id}
            precioEmpresa={guardadoPrevio.precio}
            seVendeSolo={guardadoPrevio.seVendeSolo}
          />

          {enUso > 0 || !guardadoPrevio.seVendeSolo ? (
            <section className="seccion" aria-labelledby="producto-uso">
              <h2 className="formulario__titulo" id="producto-uso">
                Usado en
              </h2>
              {enUso === 0 ? (
                <p className="texto-ayuda">
                  Nada todavía. Un producto que no se vende solo y no se usa en ningún combo ni
                  opción no aparece en ninguna parte.
                </p>
              ) : (
                <ul className="carta__usos">
                  {usadoEn?.combos.map((c) => (
                    <li key={c.id}>Combo: {c.nombre}</li>
                  ))}
                  {usadoEn?.modificadores.map((m) => (
                    <li key={m.id}>
                      Opción: {m.grupoNombre} › {m.nombre}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="formulario__aparte" aria-labelledby="producto-estado">
            <h2 className="formulario__titulo" id="producto-estado">
              {guardadoPrevio.activo ? 'Desactivar' : 'Reactivar'}
            </h2>
            {guardadoPrevio.activo ? (
              <>
                <p className="texto-ayuda">
                  Deja de aparecer en la carta de todas las sucursales. No se borra: puedes
                  reactivarlo cuando quieras.
                </p>
                <Boton variante="peligro" bloque onClick={() => setConfirmandoDesactivar(true)}>
                  Desactivar producto
                </Boton>
              </>
            ) : (
              <>
                <p className="texto-ayuda">
                  Está fuera de la carta. Al reactivarlo vuelve a aparecer.
                </p>
                <Boton
                  bloque
                  cargando={cambiandoActivo}
                  textoCargando="Reactivando…"
                  onClick={() => void cambiarActivo(true)}
                >
                  Reactivar producto
                </Boton>
              </>
            )}
          </section>

          <DialogoConfirmacion
            abierta={confirmandoDesactivar}
            titulo={`¿Desactivar «${guardadoPrevio.nombre}»?`}
            etiquetaConfirmar="Desactivar producto"
            textoCargando="Desactivando…"
            peligro
            cargando={cambiandoActivo}
            onConfirmar={() => void cambiarActivo(false)}
            onCancelar={() => setConfirmandoDesactivar(false)}
          >
            <p>
              Dejará de aparecer en la carta de todas las sucursales.
              {usadoEn && usadoEn.combos.length > 0
                ? ' Los combos que lo contienen dejarán de poder venderse.'
                : ''}{' '}
              Podrás reactivarlo cuando quieras.
            </p>
          </DialogoConfirmacion>

          <DialogoConfirmacion
            abierta={porConfirmar !== null}
            titulo={`¿Cambiar a ${tipoEnFrase(porConfirmar?.tipo ?? estado.tipo)}?`}
            etiquetaConfirmar={`Cambiar a ${tipoEnFrase(porConfirmar?.tipo ?? estado.tipo)}`}
            textoCargando="Cambiando…"
            peligro
            cargando={enviando}
            error={
              falloDeConfirmacion ? (
                <Aviso tipo="error" titulo="No pudimos cambiarlo">
                  {falloDeConfirmacion}
                </Aviso>
              ) : undefined
            }
            onConfirmar={() => void confirmarCambioDeTipo()}
            onCancelar={() => {
              setPorConfirmar(null);
              setFalloDeConfirmacion(null);
            }}
          >
            <p>Para cambiar el tipo hay que quitar esto. No se puede deshacer:</p>
            <ul className="carta__usos confirmacion__lista">
              {frasesDeConfirmacion.map((frase) => (
                <li key={frase}>{frase}</li>
              ))}
            </ul>
            <p className="texto-ayuda">
              Las ventas que ya se hicieron no cambian. Lo demás del producto se conserva.
            </p>
          </DialogoConfirmacion>
        </>
      ) : null}
    </Pagina>
  );
}

/** El 409 `EN_USO` de un cambio de tipo, con palabras y enlaces: no ofrece continuar (criterio 10c). */
function AvisoDeUso({
  uso,
  tipoGuardado,
  alVolver,
}: {
  uso: UsoQueImpide;
  tipoGuardado: TipoProducto | undefined;
  alVolver: () => void;
}) {
  const { combos, modificadores } = uso.usadoEn;
  return (
    <Aviso tipo="error" titulo={`No se puede cambiar a ${tipoEnFrase(uso.tipo)}`}>
      <p>
        Este producto se usa en otros lugares, y un combo o un menú no puede llevar otro combo ni un
        menú. Quítalo de ahí antes de convertirlo en {tipoEnFrase(uso.tipo)}. Se usa en:
      </p>
      <ul className="carta__usos">
        {combos.map((c) => (
          <li key={c.id}>
            Combo{' '}
            <Link to={`/carta/productos/${c.id}`} className="enlace-texto">
              {c.nombre}
            </Link>
          </li>
        ))}
        {modificadores.map((m) => (
          <li key={m.id}>
            Opción «{m.nombre}» del grupo{' '}
            <Link to={`/carta/grupos/${m.grupoId}`} className="enlace-texto">
              {m.grupoNombre}
            </Link>
          </li>
        ))}
      </ul>
      {tipoGuardado ? (
        <Boton variante="texto" onClick={alVolver}>
          Dejarlo como {tipoEnFrase(tipoGuardado)}
        </Boton>
      ) : null}
    </Aviso>
  );
}
