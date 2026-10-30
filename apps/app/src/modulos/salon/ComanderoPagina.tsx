import type { ProductoDeVenta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  CONSULTA_TABLET,
  Icono,
  IconoArriba,
  IconoCarta,
  IconoIzquierda,
  useCoincide,
} from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi } from '../../lib/errores';
import { montoEnSoles } from '../../lib/monto';
import { useSesionActiva } from '../acceso/sesion';
import { useVistaDeSucursal } from '../disponibilidad/useVistaDeSucursal';
import {
  claveDeBorrador,
  pasarBorrador,
  totalDelBorrador,
  unidadesDelBorrador,
  useBorrador,
  type LineaBorrador,
} from './borrador';
import { CartaDelComandero } from './CartaDelComandero';
import { familiasParaVender } from './comandero';
import { enviarBorrador } from './enviar-borrador';
import { HojaDeProducto } from './HojaDeProducto';
import { estaAbierta, textoDeItems, tituloDeMesas } from './ordenes';
import { PorEnviar } from './PorEnviar';
import { rutaDeComandero, rutaDeOrden } from './salon';
import { useOrden } from './useOrden';
import './comandero.css';

type Panel = 'carta' | 'borrador';

/** Lo que la pantalla anterior le pide al comandero al llegar. */
interface EstadoDeLlegada {
  vista?: Panel;
  unida?: boolean;
}

/** `/salon/ordenes/:id/agregar`: el comandero de una cuenta (criterios 91 y 92 de 004). */
export function ComanderoPagina() {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Agregar" atras={{ a: '/salon', etiqueta: 'Salón' }}>
        <EstadoVacio icono={IconoCarta} titulo="Elige una sucursal">
          La carta es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Comandero
      key={`${id}.${sesion.usuario?.id ?? 'soporte'}.${sesion.sucursal.id}`}
      ordenId={id}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? null}
      sucursalId={sesion.sucursal.id}
    />
  );
}

function Comandero({
  ordenId,
  empresaId,
  usuarioId,
  sucursalId,
}: {
  ordenId: string;
  empresaId: string;
  usuarioId: string | null;
  sucursalId: string;
}) {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [llegada] = useState<EstadoDeLlegada>(
    () => (ubicacion.state as EstadoDeLlegada | null) ?? {},
  );
  const clientes = useQueryClient();
  const consultaOrden = useOrden(ordenId);
  const consultaCarta = useVistaDeSucursal(sucursalId);
  const clave = claveDeBorrador(empresaId, usuarioId, ordenId);
  const borrador = useBorrador(clave);
  const ancha = useCoincide(CONSULTA_TABLET);

  const [panel, setPanel] = useState<Panel>(
    llegada.vista ?? (borrador.envioId !== null ? 'borrador' : 'carta'),
  );
  const [abierto, setAbierto] = useState<{
    producto: ProductoDeVenta;
    linea: LineaBorrador | null;
  } | null>(null);
  const [anuncio, setAnuncio] = useState('');
  useEffect(() => {
    if (ubicacion.state !== null) navegar('.', { replace: true, state: null });
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sinProducto, setSinProducto] = useState<string | null>(null);

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const orden = consultaOrden.data?.orden;
  const carta = consultaCarta.data?.vista;
  const familias = useMemo(() => familiasParaVender(carta?.familias ?? []), [carta]);

  // La cuenta se unió a otra: el borrador pasa a la nueva. Si hay un envío sin terminar no se toca; se
  // reintenta con su mismo id y el servidor dice si llegó o a qué cuenta ir (criterio 29).
  const unidaA = orden?.estado === 'UNIDA' ? orden.unidaA : null;
  useEffect(() => {
    if (!unidaA || borrador.envioId !== null) return;
    pasarBorrador(clave, claveDeBorrador(empresaId, usuarioId, unidaA));
    navegar(rutaDeComandero(unidaA), { replace: true, state: { vista: 'borrador', unida: true } });
  }, [unidaA, borrador.envioId, clave, empresaId, usuarioId, navegar]);

  const unidades = unidadesDelBorrador(borrador.lineas);
  const abierta = orden ? estaAbierta(orden) : true;
  const bloqueado = borrador.envioId !== null;

  function elegir(producto: ProductoDeVenta) {
    setSinProducto(null);
    setAbierto({ producto, linea: null });
  }

  function editar(linea: LineaBorrador) {
    const producto = (carta?.familias ?? [])
      .flatMap((f) => f.productos)
      .find((p) => p.id === linea.productoId);
    if (!producto) {
      setSinProducto(
        `${linea.nombre} ya no está en la carta de esta sucursal. Quita la línea para poder enviar.`,
      );
      return;
    }
    setSinProducto(null);
    setAbierto({ producto, linea });
  }

  function guardar(linea: LineaBorrador) {
    if (abierto?.linea) borrador.reemplazar(abierto.linea.clave, linea);
    else borrador.agregar(linea);
    setAnuncio(
      `${abierto?.linea ? 'Cambiaste' : 'Agregaste'} ${linea.cantidad} × ${linea.nombre}.`,
    );
    setAbierto(null);
  }

  async function enviar() {
    const resultado = await enviarBorrador({ clave, ordenId, clientes });
    if (!montado.current) return;
    if (resultado.resultado === 'enviado') {
      navegar(rutaDeOrden(ordenId), {
        replace: true,
        state: {
          enviado: { numero: resultado.envio.numero, esAdicion: resultado.envio.esAdicion },
        },
      });
    } else if (resultado.resultado === 'otra-orden') {
      pasarBorrador(clave, claveDeBorrador(empresaId, usuarioId, resultado.ordenId));
      navegar(rutaDeComandero(resultado.ordenId), {
        replace: true,
        state: { vista: 'borrador', unida: true },
      });
    } else if (resultado.resultado !== 'nada') {
      // Lo que no pasó (o no se sabe si pasó) está en «Por enviar»: se lleva ahí.
      setPanel('borrador');
    }
  }

  if (
    !orden &&
    consultaOrden.error instanceof ErrorApi &&
    consultaOrden.error.codigo === 'NO_ENCONTRADO'
  ) {
    return <Navigate to="/salon" replace />;
  }

  const mesas = orden ? tituloDeMesas(orden.mesas) : 'la cuenta';
  const hayQueEnviar = borrador.lineas.length > 0 || borrador.porReintentar;

  const totalPorEnviar = montoEnSoles(totalDelBorrador(borrador.lineas));
  // En el celular, tocar el resumen lleva a revisar lo que falta enviar; en pantallas anchas ya está a la vista.
  const resumenTocable = !ancha && panel === 'carta' && borrador.lineas.length > 0;

  const pie =
    abierta && hayQueEnviar ? (
      <div className="comandero__pie">
        {resumenTocable ? (
          <button
            type="button"
            className="comandero__resumen comandero__resumen--boton"
            aria-label={`Revisar lo que falta enviar: ${textoDeItems(unidades)}, ${totalPorEnviar}`}
            onClick={() => setPanel('borrador')}
          >
            <span className="comandero__resumen-texto">
              <span>{textoDeItems(unidades)} por enviar</span>
              <b>{totalPorEnviar}</b>
            </span>
            <Icono icono={IconoArriba} tamano={20} />
          </button>
        ) : (
          <div className="comandero__resumen">
            <span className="comandero__resumen-texto">
              <span>{textoDeItems(unidades)} por enviar</span>
              <b>{totalPorEnviar}</b>
            </span>
          </div>
        )}
        <Boton
          variante="principal"
          cargando={borrador.fase !== null}
          textoCargando={borrador.fase === 'esperando-red' ? 'Pendiente de envío' : 'Enviando…'}
          onClick={() => void enviar()}
        >
          {borrador.porReintentar ? 'Reintentar el envío' : 'Enviar'}
        </Boton>
      </div>
    ) : undefined;

  const verCarta = ancha || panel === 'carta';
  const verPorEnviar = ancha || panel === 'borrador';

  return (
    <Pagina
      titulo={`Agregar a ${mesas}`}
      atras={{ a: rutaDeOrden(ordenId), etiqueta: orden ? tituloDeMesas(orden.mesas) : 'Cuenta' }}
      ancho="ancho"
      {...(pie ? { pie } : {})}
    >
      {llegada.unida ? (
        <Aviso tipo="info" titulo="La cuenta se unió a otra">
          Lo que tenías por enviar pasó a esta cuenta.
        </Aviso>
      ) : null}
      {orden && !abierta ? (
        <Aviso tipo="alerta" titulo="Esta cuenta ya no está abierta">
          No se puede agregar nada. Vuelve al salón para abrir otra mesa.
        </Aviso>
      ) : null}
      {sinProducto ? (
        <Aviso tipo="alerta" titulo="Producto fuera de la carta">
          {sinProducto}
        </Aviso>
      ) : null}

      <div className={ancha ? 'comandero comandero--ancho' : 'comandero'}>
        {verCarta ? (
          <section className="comandero__panel" aria-label="Carta">
            {bloqueado ? (
              <Aviso tipo="alerta" titulo="Primero termina el envío">
                Hay un envío sin terminar. Reinténtalo desde «Por enviar» antes de agregar más
                productos.
              </Aviso>
            ) : consultaCarta.isPending ? (
              <EsqueletoDeLista filas={5} conInicial={false} etiqueta="Cargando la carta" />
            ) : !carta ? (
              <ErrorDeCarga
                titulo="No pudimos cargar la carta"
                onReintentar={() => void consultaCarta.refetch()}
                reintentando={consultaCarta.isFetching}
              >
                Revisa tu conexión e inténtalo de nuevo.
              </ErrorDeCarga>
            ) : familias.length === 0 ? (
              <EstadoVacio icono={IconoCarta} titulo="La carta no tiene productos para vender">
                Pide al administrador que cargue los productos de esta sucursal.
              </EstadoVacio>
            ) : (
              <>
                {consultaCarta.isError ? (
                  <Aviso tipo="alerta" titulo="No pudimos actualizar la carta">
                    Lo que ves puede estar desactualizado. Seguimos intentando.
                  </Aviso>
                ) : null}
                <CartaDelComandero familias={familias} onElegir={elegir} />
              </>
            )}
          </section>
        ) : null}

        {verPorEnviar ? (
          <section className="comandero__panel" aria-label="Por enviar">
            <div className="comandero__encabezado">
              <h2 className="comandero__titulo">Por enviar</h2>
              {ancha ? null : (
                <Boton variante="texto" icono={IconoIzquierda} onClick={() => setPanel('carta')}>
                  Seguir agregando
                </Boton>
              )}
            </div>
            <PorEnviar borrador={borrador} onEditar={editar} />
          </section>
        ) : null}
      </div>

      <p className="ui-solo-lectores" role="status">
        {anuncio}
      </p>

      <HojaDeProducto
        producto={abierto?.producto ?? null}
        linea={abierto?.linea ?? null}
        onGuardar={guardar}
        onCerrar={() => setAbierto(null)}
      />
    </Pagina>
  );
}
