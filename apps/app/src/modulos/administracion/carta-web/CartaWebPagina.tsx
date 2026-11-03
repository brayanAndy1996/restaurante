import type { CartaWebRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoTexto,
  ErrorDeCarga,
  EsqueletoDeLista,
  IconoOk,
  Icono,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { AvisoPendiente } from '../../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { MarcoDeAjustes } from '../MarcoDeAjustes';
import {
  borradorDeCartaWeb,
  claveCartaWeb,
  colorEscrito,
  colorValido,
  conSucursalGuardada,
  direccionEscrita,
  falloDeCartaWeb,
  falloDeSucursal,
  guardarCartaWeb,
  guardarSucursalDeCartaWeb,
  hayCambios,
  leerCartaWeb,
  marcaEnLaCarta,
  propuestaDeDireccion,
  sitioDeLaCarta,
  validarCartaWeb,
  vistaDeLaDireccion,
  type BorradorDeCartaWeb,
  type ErroresDeCartaWeb,
} from './carta-web';
import { LogoDeCartaWeb } from './LogoDeCartaWeb';
import { MuestraDeMarca } from './MuestraDeMarca';
import { SucursalesDeCartaWeb } from './SucursalesDeCartaWeb';
import './carta-web.css';

const ID_FORMULARIO = 'formulario-carta-web';

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
 * Ajustes › Carta web (criterios 74 y 76): lo que ve el cliente al escanear un QR o abrir tu enlace. El
 * Administrador define el nombre, la dirección, el logo y el color, y por sucursal su dirección y si está
 * publicada.
 */
export function CartaWebPagina() {
  const consulta = useQuery({
    queryKey: claveCartaWeb,
    queryFn: ({ signal }) => leerCartaWeb(signal),
  });
  if (consulta.data) return <FormularioDeCartaWeb carta={consulta.data} />;
  return (
    <MarcoDeAjustes actual="carta-web">
      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando la carta web" conInicial={false} filas={3} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar la carta web"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : null}
    </MarcoDeAjustes>
  );
}

function FormularioDeCartaWeb({ carta }: { carta: CartaWebRespuesta }) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const [borrador, setBorrador] = useState<BorradorDeCartaWeb>(() => borradorDeCartaWeb(carta));
  const [errores, setErrores] = useState<ErroresDeCartaWeb>({ sucursales: {} });
  const [general, setGeneral] = useState<string>();
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const idColor = useId();

  const guardada = carta.configurada ? carta : null;
  const sitio = sitioDeLaCarta(carta);
  const cambios = hayCambios(carta, borrador);
  const marca = marcaEnLaCarta(borrador.colorPrincipal);
  const propuesta = propuestaDeDireccion(borrador.nombre);
  const direccion = borrador.slug.trim();
  const direccionCambiada =
    guardada !== null && direccion !== (carta.slug ?? '') && direccion !== '';

  function cambiar(parcial: Partial<BorradorDeCartaWeb>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setConfirmacion('');
    setGeneral(undefined);
  }

  function cambiarNombre(nombre: string) {
    // Mientras nadie escriba la dirección a mano, sigue al nombre (solo la primera vez que se configura).
    setBorrador((b) => ({
      ...b,
      nombre,
      ...(b.direccionManual ? {} : { slug: propuestaDeDireccion(nombre) }),
    }));
    setErrores((e) => ({
      ...e,
      nombre: undefined,
      ...(borrador.direccionManual ? {} : { slug: undefined }),
    }));
    setConfirmacion('');
    setGeneral(undefined);
  }

  function cambiarDireccion(texto: string) {
    cambiar({ slug: direccionEscrita(texto), direccionManual: true });
    setErrores((e) => ({ ...e, slug: undefined }));
  }

  function cambiarColor(texto: string) {
    cambiar({ colorPrincipal: colorEscrito(texto) });
    setErrores((e) => ({ ...e, colorPrincipal: undefined }));
  }

  function cambiarSucursal(id: string, parcial: Partial<BorradorDeCartaWeb['sucursales'][number]>) {
    setBorrador((b) => ({
      ...b,
      sucursales: b.sucursales.map((s) => (s.sucursalId === id ? { ...s, ...parcial } : s)),
    }));
    setErrores((e) => {
      const { [id]: _quitado, ...resto } = e.sucursales;
      return { ...e, sucursales: resto };
    });
    setConfirmacion('');
    setGeneral(undefined);
  }

  function ponerEnCache(nueva: CartaWebRespuesta) {
    clientes.setQueryData(claveCartaWeb, nueva);
  }

  async function guardar(evento?: FormEvent) {
    evento?.preventDefault();
    if (guardando) return;
    const resultado = validarCartaWeb(carta, borrador);
    if (!resultado.ok) {
      setErrores(resultado.errores);
      mostrarProblema();
      return;
    }
    setErrores({ sucursales: {} });
    setGeneral(undefined);
    setConfirmacion('');
    setGuardando(true);
    let actual = carta;
    try {
      // La empresa va primero: las sucursales cuelgan de su configuración (409 si no existe).
      if (resultado.empresa) {
        const entrada = resultado.empresa;
        try {
          actual = await envio.enviar((extra) => guardarCartaWeb(entrada, extra));
          ponerEnCache(actual);
        } catch (error) {
          const fallo = falloDeCartaWeb(error);
          setErrores({ ...fallo.campos, sucursales: {} });
          setGeneral(fallo.general);
          mostrarProblema();
          return;
        }
      }
      const fallosDeSucursal: Record<string, string> = {};
      for (const cambio of resultado.sucursales) {
        const { sucursalId, ...entrada } = cambio;
        try {
          const sucursal = await envio.enviar((extra) =>
            guardarSucursalDeCartaWeb(sucursalId, entrada, extra),
          );
          actual = conSucursalGuardada(actual, sucursal);
          ponerEnCache(actual);
        } catch (error) {
          fallosDeSucursal[sucursalId] = falloDeSucursal(error);
        }
      }
      if (Object.keys(fallosDeSucursal).length > 0) {
        setErrores({ sucursales: fallosDeSucursal });
        mostrarProblema();
        return;
      }
      setBorrador((b) => ({
        ...b,
        nombre: b.nombre.trim(),
        slug: b.slug.trim(),
        direccionManual: true,
      }));
      setConfirmacion('Cambios guardados. Tu carta ya tiene estos datos.');
    } finally {
      setGuardando(false);
    }
  }

  function cambiarLogo(logoUrl: string | null) {
    ponerEnCache({ ...carta, logoUrl });
    setConfirmacion(logoUrl ? 'Logo guardado.' : 'Logo quitado.');
  }

  const vista = vistaDeLaDireccion(sitio, direccion);
  const colorInvalido = errores.colorPrincipal !== undefined;

  const pie = (
    <Boton
      variante="principal"
      bloque
      type="submit"
      form={ID_FORMULARIO}
      cargando={guardando}
      textoCargando="Guardando…"
      disabled={!cambios}
    >
      Guardar
    </Boton>
  );

  return (
    <MarcoDeAjustes actual="carta-web" pie={pie}>
      <p className="texto-ayuda carta-web__intro">
        Es la carta que ven tus clientes cuando escanean el QR de una mesa o abren tu enlace.
      </p>
      <AvisoPendiente pendiente={envio.pendiente} />
      {!carta.configurada ? (
        <Aviso tipo="info" titulo="Aún no configuraste tu carta web">
          Escribe el nombre y la dirección de tu restaurante y guarda. Después podrás subir tu logo
          y publicar cada sucursal.
        </Aviso>
      ) : null}
      {confirmacion ? <Aviso tipo="ok" titulo={confirmacion} /> : null}
      {general ? (
        <Aviso tipo="error" titulo="No pudimos guardar la carta">
          {general}
        </Aviso>
      ) : null}

      <form
        id={ID_FORMULARIO}
        className="formulario carta-web"
        onSubmit={(e) => void guardar(e)}
        noValidate
      >
        <section className="carta-web__grupo" aria-labelledby="carta-web-restaurante">
          <h3 className="formulario__titulo" id="carta-web-restaurante">
            Tu restaurante
          </h3>
          <CampoTexto
            etiqueta="Nombre que ven tus clientes"
            value={borrador.nombre}
            onChange={(e) => cambiarNombre(e.target.value)}
            error={errores.nombre}
            maxLength={80}
            autoComplete="organization"
            ayuda="No es tu razón social: es el nombre con el que te conocen."
          />
          <CampoTexto
            etiqueta="Dirección de tu carta"
            value={borrador.slug}
            onChange={(e) => cambiarDireccion(e.target.value)}
            error={errores.slug}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            ayuda={
              <>
                Tu carta se verá en <b className="carta-web__vista">{vista}</b>
              </>
            }
          />
          {propuesta !== '' && propuesta !== direccion ? (
            <div className="carta-web__propuesta">
              <p className="texto-ayuda">
                Propuesta según tu nombre: <b>{propuesta}</b>
              </p>
              <Boton variante="texto" onClick={() => cambiarDireccion(propuesta)}>
                Usar esta dirección
              </Boton>
            </div>
          ) : !borrador.direccionManual && direccion !== '' ? (
            <p className="texto-ayuda">Sugerida a partir de tu nombre. Puedes cambiarla.</p>
          ) : null}
          {direccionCambiada && !errores.slug ? (
            <Aviso
              tipo="alerta"
              titulo="Si cambias la dirección, el enlace anterior deja de funcionar"
            >
              Quien tenga guardado «{sinProtocoloDeSitio(sitio, carta.slug)}» verá «La carta no está
              disponible». Los QR de las mesas no cambian.
            </Aviso>
          ) : null}
        </section>

        <section className="carta-web__grupo" aria-labelledby="carta-web-marca">
          <h3 className="formulario__titulo" id="carta-web-marca">
            Logo y color
          </h3>
          <LogoDeCartaWeb
            nombre={borrador.nombre.trim()}
            logoUrl={carta.logoUrl}
            habilitado={carta.configurada}
            onCambio={cambiarLogo}
          />
          <div className="carta-web__color">
            <CampoTexto
              id={idColor}
              etiqueta="Color de tu marca"
              value={borrador.colorPrincipal}
              onChange={(e) => cambiarColor(e.target.value)}
              error={errores.colorPrincipal}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={7}
              ayuda="Escríbelo como #RRGGBB o elígelo con el selector."
            />
            <label
              className={`carta-web__selector${colorInvalido ? ' carta-web__selector--error' : ''}`}
            >
              <span className="ui-solo-lectores">Elegir el color con el selector</span>
              <input
                type="color"
                value={
                  colorValido(borrador.colorPrincipal)
                    ? borrador.colorPrincipal.toLowerCase()
                    : '#1d4a9e'
                }
                onChange={(e) => cambiarColor(e.target.value)}
              />
            </label>
          </div>
          {marca ? (
            <>
              <MuestraDeMarca nombre={borrador.nombre} logoUrl={carta.logoUrl} marca={marca} />
              {marca.seOscurecio ? (
                <Aviso tipo="alerta" titulo="Oscurecimos un poco tu color para que se lea bien">
                  Con letras blancas, {borrador.colorPrincipal} tiene un contraste de{' '}
                  {marca.contrasteElegido}:1 y el mínimo es 4.5:1. En tu carta usaremos{' '}
                  {marca.fondo}.
                </Aviso>
              ) : (
                <p className="carta-web__contraste texto-ayuda">
                  <Icono icono={IconoOk} tamano={16} />
                  Con letras blancas tiene un contraste de {marca.contrasteElegido}:1: se lee bien.
                </p>
              )}
            </>
          ) : null}
        </section>

        <section className="carta-web__grupo" aria-labelledby="carta-web-sucursales">
          <h3 className="formulario__titulo" id="carta-web-sucursales">
            Sucursales
          </h3>
          {carta.sucursales.length === 0 ? (
            <p className="texto-ayuda">Aún no hay sucursales en tu empresa.</p>
          ) : (
            <>
              <p className="texto-ayuda">
                Cada sucursal tiene su propia dirección y se publica por separado.
              </p>
              <SucursalesDeCartaWeb
                carta={carta}
                borradores={borrador.sucursales}
                errores={errores.sucursales}
                direccionDeLaEmpresa={direccion}
                sitio={sitio}
                onCambio={cambiarSucursal}
              />
            </>
          )}
        </section>
      </form>
    </MarcoDeAjustes>
  );
}

/** La dirección guardada, como se vería escrita: "carta.ejemplo.pe/sabor-norteno". */
function sinProtocoloDeSitio(sitio: string | null, slug: string | null): string {
  return `${sitio ?? '…'}/${slug ?? '…'}`;
}
