import type { QrMesaDeLista, QrMesasRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoImpresora,
  IconoMas,
  IconoQr,
  claseBoton,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AvisoPendiente } from '../../../../componentes/PendienteDeEnvio';
import { Pagina } from '../../../../componentes/Pagina';
import { useEnvioPendiente } from '../../../../lib/envios';
import { useSesionActiva } from '../../../acceso/sesion';
import { FilaDeQr } from './FilaDeQr';
import {
  agruparPorZona,
  cambiarQrDeMesa,
  claveQrMesas,
  conQrCambiado,
  crearQrFaltantes,
  listarQrMesas,
  mensajeDeCambioDeQr,
  mensajeDeQr,
  mesasSinCodigo,
  nombreDeMesa,
  pluralMesas,
  tieneCodigo,
} from './qr';
import './qr.css';

const ATRAS = { a: '/administracion/mesas', etiqueta: 'Mapa de mesas' } as const;
/** Mientras esta pantalla está abierta, la hoja imprime solo las tarjetas (ver `qr.css`). */
const CLASE_DE_IMPRESION = 'imprime-hoja-qr';

const claveDeDibujo = (m: QrMesaDeLista) => `${m.mesaId}:${m.codigo ?? ''}`;

/**
 * Ajustes › Mapa de mesas › QR de las mesas (criterios 75 y 76, HU-42): el QR de cada mesa por zona, "Crear los QR
 * que faltan", "Imprimir la hoja" (A4, seis tarjetas por hoja) y "Cambiar QR" con confirmación. Los QR se dibujan en
 * el equipo; la hoja se imprime con el diálogo del navegador (ahí mismo se guarda como PDF).
 */
export function QrDeMesasPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="QR de las mesas" atras={ATRAS}>
        <EstadoVacio icono={IconoQr} titulo="Elige una sucursal">
          Los QR son de las mesas de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return <QrDeSucursal key={sesion.sucursal.id} sucursalId={sesion.sucursal.id} />;
}

function QrDeSucursal({ sucursalId }: { sucursalId: string }) {
  const clientes = useQueryClient();
  const clave = claveQrMesas(sucursalId);
  const consulta = useQuery({
    queryKey: clave,
    queryFn: ({ signal }) => listarQrMesas(sucursalId, signal),
  });
  const envio = useEnvioPendiente();

  const [confirmacion, setConfirmacion] = useState('');
  const [falloCrear, setFalloCrear] = useState<string>();
  const [creando, setCreando] = useState(false);
  const [cambiando, setCambiando] = useState<QrMesaDeLista | null>(null);
  const [falloCambio, setFalloCambio] = useState<string>();
  const [cambiandoAhora, setCambiandoAhora] = useState(false);
  const [nuevos, setNuevos] = useState<ReadonlySet<string>>(new Set());
  const [dibujados, setDibujados] = useState<ReadonlySet<string>>(new Set());
  const [fallidos, setFallidos] = useState<ReadonlySet<string>>(new Set());

  // Mientras la pantalla está abierta, imprimir saca solo la hoja de tarjetas.
  useEffect(() => {
    document.documentElement.classList.add(CLASE_DE_IMPRESION);
    return () => document.documentElement.classList.remove(CLASE_DE_IMPRESION);
  }, []);

  const datos = consulta.data;
  const conCodigo = useMemo(() => (datos?.mesas ?? []).filter(tieneCodigo), [datos]);
  const faltan = useMemo(() => mesasSinCodigo(datos?.mesas ?? []), [datos]);
  const zonas = useMemo(() => agruparPorZona(datos?.mesas ?? []), [datos]);

  const terminoDibujo = useCallback((mesa: QrMesaDeLista, dibujado: boolean) => {
    const clave = claveDeDibujo(mesa);
    const sumar = (previo: ReadonlySet<string>) =>
      previo.has(clave) ? previo : new Set(previo).add(clave);
    if (dibujado) setDibujados(sumar);
    else setFallidos(sumar);
  }, []);
  const porDibujar = conCodigo.filter(
    (m) => !dibujados.has(claveDeDibujo(m)) && !fallidos.has(claveDeDibujo(m)),
  ).length;
  const sinDibujar = conCodigo.filter((m) => fallidos.has(claveDeDibujo(m))).length;

  function ponerLista(lista: QrMesasRespuesta) {
    clientes.setQueryData(clave, lista);
  }

  async function crearLosQueFaltan() {
    if (creando) return;
    setCreando(true);
    setFalloCrear(undefined);
    setConfirmacion('');
    const antes = faltan.length;
    try {
      const lista = await envio.enviar((extra) => crearQrFaltantes(sucursalId, extra));
      ponerLista(lista);
      const quedan = mesasSinCodigo(lista.mesas).length;
      const creados = antes - quedan;
      setConfirmacion(
        creados > 0
          ? `Listo: se crearon ${creados === 1 ? 'el QR de 1 mesa' : `los QR de ${creados} mesas`}. Ya puedes imprimir la hoja.`
          : 'Todas las mesas ya tienen su QR.',
      );
    } catch (error) {
      setFalloCrear(mensajeDeQr(error));
    } finally {
      setCreando(false);
    }
  }

  async function cambiarElQr() {
    if (!cambiando || cambiandoAhora) return;
    const mesa = cambiando;
    setCambiandoAhora(true);
    setFalloCambio(undefined);
    try {
      const nuevo = await envio.enviar((extra) => cambiarQrDeMesa(sucursalId, mesa.mesaId, extra));
      const actual = clientes.getQueryData<QrMesasRespuesta>(clave);
      if (actual) ponerLista(conQrCambiado(actual, nuevo));
      setNuevos((previo) => new Set(previo).add(mesa.mesaId));
      setCambiando(null);
      setConfirmacion(
        `El QR de la ${nombreDeMesa(mesa.nombre).toLocaleLowerCase('es-PE')} cambió. Imprime la hoja otra vez y pega el nuevo.`,
      );
    } catch (error) {
      setFalloCambio(mensajeDeCambioDeQr(error, mesa.nombre));
    } finally {
      setCambiandoAhora(false);
    }
  }

  // --- Acción fija de abajo: una sola principal --------------------------------------------------------
  let pie = null;
  if (datos && datos.mesas.length > 0) {
    pie =
      conCodigo.length === 0 ? (
        <Boton
          variante="principal"
          bloque
          icono={IconoMas}
          cargando={creando}
          textoCargando="Creando…"
          onClick={() => void crearLosQueFaltan()}
        >
          Crear los QR que faltan
        </Boton>
      ) : (
        <Boton
          variante="principal"
          bloque
          icono={IconoImpresora}
          cargando={porDibujar > 0}
          textoCargando="Preparando los QR…"
          disabled={sinDibujar > 0}
          onClick={() => window.print()}
        >
          Imprimir la hoja
        </Boton>
      );
  }

  // --- Pantalla ------------------------------------------------------------------------------------------
  let cuerpo;
  if (consulta.isPending) {
    cuerpo = (
      <EsqueletoDeLista etiqueta="Cargando los QR de las mesas" conInicial={false} filas={4} />
    );
  } else if (consulta.isError) {
    cuerpo = (
      <ErrorDeCarga
        titulo="No pudimos cargar los QR"
        onReintentar={() => void consulta.refetch()}
        reintentando={consulta.isFetching}
      >
        {mensajeDeQr(consulta.error)}
      </ErrorDeCarga>
    );
  } else if (!datos || datos.mesas.length === 0) {
    cuerpo = (
      <EstadoVacio
        icono={IconoQr}
        titulo="Aún no hay mesas"
        accion={
          <Link to={ATRAS.a} className={claseBoton('principal')}>
            Ir al mapa de mesas
          </Link>
        }
      >
        Crea las mesas de tu sucursal en el mapa. Cada una tendrá su propio QR.
      </EstadoVacio>
    );
  } else {
    cuerpo = (
      <>
        {!datos.cartaPublicada ? (
          <Aviso tipo="alerta" titulo="La carta de esta sucursal no está publicada">
            Si imprimes los QR ahora, quien los escanee verá «La carta no está disponible».{' '}
            <Link className="enlace-texto" to="/administracion/carta-web">
              Publicar la carta
            </Link>
          </Aviso>
        ) : null}
        {faltan.length > 0 && conCodigo.length > 0 ? (
          <Aviso
            tipo="info"
            titulo={
              faltan.length === 1
                ? '1 mesa todavía no tiene QR'
                : `${faltan.length} mesas todavía no tienen QR`
            }
          >
            <p>
              Son mesas creadas antes de esta función. Créalos para imprimirlos junto con los demás.
            </p>
            <Boton
              icono={IconoMas}
              cargando={creando}
              textoCargando="Creando…"
              onClick={() => void crearLosQueFaltan()}
            >
              Crear los QR que faltan
            </Boton>
          </Aviso>
        ) : null}
        {conCodigo.length === 0 ? (
          <Aviso tipo="info" titulo="Tus mesas todavía no tienen QR">
            Pulsa «Crear los QR que faltan» para generar el de cada mesa. Después podrás
            imprimirlos.
          </Aviso>
        ) : null}
        {sinDibujar > 0 ? (
          <Aviso tipo="error" titulo="No pudimos dibujar algunos QR">
            Recarga la pantalla antes de imprimir la hoja.
          </Aviso>
        ) : null}
        <div className="qr-hoja">
          {zonas.map(({ zona, mesas }) => (
            <section key={zona.id} className="qr-zona" aria-labelledby={`qr-zona-${zona.id}`}>
              <h2
                className="formulario__titulo qr-zona__titulo qr-pantalla"
                id={`qr-zona-${zona.id}`}
              >
                {zona.nombre}
                <span className="texto-ayuda"> · {pluralMesas(mesas.length)}</span>
              </h2>
              <ul className="ui-lista qr-lista" aria-label={`Mesas de ${zona.nombre}`}>
                {mesas.map((mesa) => (
                  <FilaDeQr
                    key={mesa.mesaId}
                    mesa={mesa}
                    sucursal={datos.sucursal.nombre}
                    nuevo={nuevos.has(mesa.mesaId)}
                    onCambiar={(m) => {
                      setFalloCambio(undefined);
                      setCambiando(m);
                    }}
                    onTerminarDibujo={terminoDibujo}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </>
    );
  }

  return (
    <Pagina titulo="QR de las mesas" atras={ATRAS} {...(pie ? { pie } : {})}>
      <p className="texto-ayuda qr-pantalla">
        Cada mesa tiene su propio QR. Tus clientes lo escanean para ver la carta y llamar al mozo.
      </p>
      <AvisoPendiente pendiente={envio.pendiente} />
      {confirmacion ? (
        <div className="qr-pantalla">
          <Aviso tipo="ok" titulo={confirmacion} />
        </div>
      ) : null}
      {falloCrear ? (
        <Aviso tipo="error" titulo="No pudimos crear los QR">
          {falloCrear}
        </Aviso>
      ) : null}
      {cuerpo}
      <DialogoConfirmacion
        abierta={cambiando !== null}
        titulo={`¿Cambiar el QR de la ${cambiando ? nombreDeMesa(cambiando.nombre).toLocaleLowerCase('es-PE') : 'mesa'}?`}
        etiquetaConfirmar="Cambiar QR"
        textoCargando="Cambiando…"
        peligro
        cargando={cambiandoAhora}
        error={
          falloCambio ? (
            <Aviso tipo="error" titulo="No se cambió el QR">
              {falloCambio}
            </Aviso>
          ) : undefined
        }
        onConfirmar={() => void cambiarElQr()}
        onCancelar={() => {
          if (!cambiandoAhora) setCambiando(null);
        }}
      >
        <p>
          El QR impreso de la{' '}
          {cambiando ? nombreDeMesa(cambiando.nombre).toLocaleLowerCase('es-PE') : 'mesa'} dejará de
          funcionar. Tendrás que imprimir y pegar el nuevo.
        </p>
      </DialogoConfirmacion>
    </Pagina>
  );
}
