import type { MesaDelSalon, SalonRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  CuadriculaDeMesas,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoMapa,
  IconoUnidas,
  Interruptor,
  ListaDeFilas,
  Segmentos,
  claseBoton,
  claseFila,
  nombreAccesibleDeMesa,
} from '@restaurante/ui';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import {
  guardarPreferenciaDelSalon,
  preferenciaDelSalon,
  type VistaDelSalon,
} from '../../lib/almacen';
import { useAnchoDe } from '../../lib/medidas';
import { useEstadoTiempoReal } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { AbrirMesaHoja, type MesaPorAbrir } from './AbrirMesaHoja';
import {
  TEXTO_DE_ESTADO,
  TONO_DE_ESTADO,
  ayudaDeFila,
  cabeElMapa,
  contarEstados,
  gruposDeZona,
  ladoDeCelda,
  mesasDeCuadricula,
  mesasEnOrdenDeLectura,
  rutaDeOrden,
  textoDeConteo,
  totalDeMesa,
} from './salon';
import { useAhoraDelSalon, useSalon } from './useSalon';

type ZonaDelSalon = SalonRespuesta['zonas'][number];

/** `/salon`: el mapa de la sucursal por zona, o la lista, con el estado de cada mesa (criterios 7, 8 y 88). */
export function SalonPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Salón" ancho="ancho">
        <EstadoVacio icono={IconoMapa} titulo="Elige una sucursal">
          El salón es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <SalonDeSucursal
      key={sesion.sucursal.id}
      empresaId={sesion.empresaId}
      sucursalId={sesion.sucursal.id}
      esAdministrador={sesion.esAdministrador}
    />
  );
}

function SalonDeSucursal({
  empresaId,
  sucursalId,
  esAdministrador,
}: {
  empresaId: string;
  sucursalId: string;
  esAdministrador: boolean;
}) {
  const navegar = useNavigate();
  const consulta = useSalon(sucursalId);
  const datos = consulta.data;
  const ahora = useAhoraDelSalon(datos);
  const tiempoReal = useEstadoTiempoReal();

  const marco = useRef<HTMLDivElement>(null);
  const ancho = useAnchoDe(marco);
  const [preferencia, setPreferencia] = useState(() => preferenciaDelSalon(empresaId, sucursalId));
  const [porAbrir, setPorAbrir] = useState<MesaPorAbrir | null>(null);

  const zonas = datos?.salon.zonas ?? [];
  // La zona que la persona vio la última vez; si ya no existe, la primera.
  const zona = zonas.find((z) => z.id === preferencia.zonaId) ?? zonas[0];
  const sinMesas = zonas.every((z) => z.mesas.length === 0);
  const vista: VistaDelSalon =
    preferencia.vista ?? (zona && !cabeElMapa(ancho, zona.columnas) ? 'lista' : 'mapa');

  function elegirZona(zonaId: string) {
    setPreferencia((p) => ({ ...p, zonaId }));
    guardarPreferenciaDelSalon(empresaId, sucursalId, { zonaId });
  }
  function elegirVista(nueva: VistaDelSalon) {
    setPreferencia((p) => ({ ...p, vista: nueva }));
    guardarPreferenciaDelSalon(empresaId, sucursalId, { vista: nueva });
  }
  function tocarMesa(mesa: Pick<MesaDelSalon, 'id' | 'nombre' | 'capacidad' | 'orden'>) {
    if (mesa.orden) navegar(rutaDeOrden(mesa.orden.id));
    else setPorAbrir({ id: mesa.id, nombre: mesa.nombre, capacidad: mesa.capacidad });
  }

  return (
    <Pagina titulo="Salón" ancho="ancho">
      <div className="salon" ref={marco}>
        {datos === undefined && consulta.isPending ? (
          <EsqueletoDeLista filas={5} conInicial={false} etiqueta="Cargando el salón" />
        ) : null}
        {datos === undefined && consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar el salón"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : null}
        {datos !== undefined && consulta.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar el salón">
            Lo que ves puede estar desactualizado. Seguimos intentando.
          </Aviso>
        ) : null}

        {datos !== undefined && (zonas.length === 0 || sinMesas) ? (
          <SalonSinMesas esAdministrador={esAdministrador} />
        ) : null}

        {datos !== undefined && zona && !sinMesas ? (
          <>
            {zonas.length > 1 ? (
              <Segmentos
                etiqueta="Zonas del salón"
                opciones={zonas.map((z) => ({ valor: z.id, etiqueta: z.nombre }))}
                valor={zona.id}
                onCambio={elegirZona}
              />
            ) : null}

            <div className="salon__barra">
              <ResumenDeZona zona={zona} />
              <Interruptor
                etiqueta="Lista"
                marcado={vista === 'lista'}
                onCambio={(marcado) => elegirVista(marcado ? 'lista' : 'mapa')}
              />
            </div>
            {tiempoReal === 'caido' ? (
              <p className="ui-campo__ayuda" role="status">
                Sin conexión en vivo. El salón se actualiza cada 30 segundos.
              </p>
            ) : null}

            {zona.mesas.length === 0 ? (
              <EstadoVacio icono={IconoMapa} titulo="Esta zona aún no tiene mesas">
                {esAdministrador
                  ? 'Agrégalas en Ajustes, en el mapa de mesas.'
                  : 'Pide al administrador que las agregue.'}
              </EstadoVacio>
            ) : vista === 'mapa' ? (
              <MapaDeZona
                zona={zona}
                ahora={ahora}
                lado={ladoDeCelda(ancho, zona.columnas)}
                onTocar={(id) => {
                  const mesa = zona.mesas.find((m) => m.id === id);
                  if (mesa) tocarMesa(mesa);
                }}
              />
            ) : (
              <ListaDeZona zona={zona} ahora={ahora} onTocar={tocarMesa} />
            )}
          </>
        ) : null}
      </div>
      <AbrirMesaHoja mesa={porAbrir} onCerrar={() => setPorAbrir(null)} />
    </Pagina>
  );
}

/** Sin zonas ni mesas (criterio 88): el Administrador sabe qué hacer; los demás, a quién pedirlo. */
function SalonSinMesas({ esAdministrador }: { esAdministrador: boolean }) {
  return esAdministrador ? (
    <EstadoVacio
      icono={IconoMapa}
      titulo="Diseña tu salón"
      accion={
        <Link to="/administracion/mesas" className={claseBoton('principal')}>
          Diseñar el salón
        </Link>
      }
    >
      Crea una zona y pon tus mesas en el mapa para empezar a atender.
    </EstadoVacio>
  ) : (
    <EstadoVacio icono={IconoMapa} titulo="Tu salón aún no tiene mesas">
      Pide al administrador que diseñe el salón en Ajustes.
    </EstadoVacio>
  );
}

/** Cuántas mesas hay en cada estado: las etiquetas de color explican el mapa y cuentan a la vez. */
function ResumenDeZona({ zona }: { zona: ZonaDelSalon }) {
  const cuenta = contarEstados(zona.mesas);
  return (
    <div className="etiquetas" role="group" aria-label={`Estado de las mesas de ${zona.nombre}`}>
      {(['LIBRE', 'OCUPADA', 'EN_PRECUENTA'] as const).map((estado) => (
        <EtiquetaDeEstado key={estado} tono={TONO_DE_ESTADO[estado]}>
          {textoDeConteo(estado, cuenta[estado])}
        </EtiquetaDeEstado>
      ))}
    </div>
  );
}

function MapaDeZona({
  zona,
  ahora,
  lado,
  onTocar,
}: {
  zona: ZonaDelSalon;
  ahora: number;
  lado: number;
  onTocar: (mesaId: string) => void;
}) {
  const grupos = gruposDeZona(zona);
  return (
    <>
      <CuadriculaDeMesas
        etiqueta={`Mesas de ${zona.nombre}`}
        columnas={zona.columnas}
        filas={zona.filas}
        mesas={mesasDeCuadricula(zona, ahora)}
        tamanoCelda={lado}
        onElegirMesa={onTocar}
      />
      {grupos.length > 0 ? (
        <ul className="salon__grupos" aria-label="Mesas unidas">
          {grupos.map((g) => (
            <li key={g.ordenId}>
              <Icono icono={IconoUnidas} tamano={16} />
              {g.texto}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ListaDeZona({
  zona,
  ahora,
  onTocar,
}: {
  zona: ZonaDelSalon;
  ahora: number;
  onTocar: (mesa: MesaDelSalon) => void;
}) {
  return (
    <ListaDeFilas etiqueta={`Mesas de ${zona.nombre}`}>
      {mesasEnOrdenDeLectura(zona).map((mesa) => {
        const total = totalDeMesa(mesa);
        return (
          <li key={mesa.id}>
            <button type="button" className={claseFila()} onClick={() => onTocar(mesa)}>
              <ContenidoDeFila
                titulo={nombreAccesibleDeMesa(mesa.nombre)}
                ayuda={ayudaDeFila(mesa, ahora)}
                derecha={
                  <span className="salon__fila-estado">
                    <EtiquetaDeEstado tono={TONO_DE_ESTADO[mesa.estado]}>
                      {TEXTO_DE_ESTADO[mesa.estado]}
                    </EtiquetaDeEstado>
                    {total ? <span className="salon__fila-total">{total}</span> : null}
                  </span>
                }
              />
            </button>
          </li>
        );
      })}
    </ListaDeFilas>
  );
}
