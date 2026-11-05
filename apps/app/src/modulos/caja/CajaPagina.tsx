import type { ReporteCaja, TurnoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoTienda,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pagina } from '../../componentes/Pagina';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { AbrirCaja } from './AbrirCaja';
import { EstadoDeLaImpresion } from './impresion-caja';
import { MiTurno } from './MiTurno';
import { ReporteDeCaja } from './ReporteDeCaja';
import { claveTurnoMio, leerTurnoMio, mensajeDeCaja } from './turno';
import './caja.css';

const SEGUNDOS_DE_AVISO_DE_GAVETA = 20;

/** El turno quedó cerrado: la Z en pantalla y la salida hacia "Abrir caja". */
function CajaCerrada({ reporte, onListo }: { reporte: ReporteCaja; onListo: () => void }) {
  return (
    <Pagina
      titulo="Caja"
      pie={
        <Boton variante="principal" bloque onClick={onListo}>
          Listo
        </Boton>
      }
    >
      <div className="turno">
        <Aviso tipo="ok" titulo={`${reporte.turno.caja.nombre} cerrada`}>
          Este es el reporte Z de tu turno. Ya no se pueden registrar cobros ni movimientos en él.
        </Aviso>
        <EstadoDeLaImpresion
          que="el reporte Z"
          impresion={reporte.impresion}
          trabajoId={reporte.trabajoId}
        />
        <ReporteDeCaja reporte={reporte} />
      </div>
    </Pagina>
  );
}

/**
 * `/caja` (criterios 108 a 110 y 116 de 006): sin turno abierto, las cajas de la sucursal y "Abrir caja"; con turno,
 * "Mi turno". Todo el módulo se baja al abrir esta pantalla: no cuenta en el paquete inicial.
 */
export function CajaPagina() {
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Caja">
        <EstadoVacio icono={IconoTienda} titulo="Elige una sucursal">
          La caja es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <CajaDeSucursal
      key={sesion.sucursal.id}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? ''}
      sucursalId={sesion.sucursal.id}
      esAdministrador={sesion.esAdministrador}
      suspendida={
        sesion.avisoSuscripcion?.sucursales.some(
          (s) => s.estado === 'SUSPENDIDA' && s.sucursalId === sesion.sucursal?.id,
        ) ?? false
      }
    />
  );
}

interface Props {
  empresaId: string;
  usuarioId: string;
  sucursalId: string;
  esAdministrador: boolean;
  suspendida: boolean;
}

function CajaDeSucursal({ empresaId, usuarioId, sucursalId, esAdministrador, suspendida }: Props) {
  const sondeo = useIntervaloDeSondeo();
  const [cerrada, setCerrada] = useState<ReporteCaja | null>(null);
  // Lo que dijo la API de la gaveta al abrir: el turno que se vuelve a leer ya no lo trae.
  const [apertura, setApertura] = useState<TurnoRespuesta | null>(null);
  // «Abriendo la gaveta» es de ese momento: se retira solo; «Sin impresora de caja» sigue hasta salir de la pantalla.
  useEffect(() => {
    if (apertura?.impresion !== 'EN_COLA') return;
    const id = window.setTimeout(() => setApertura(null), SEGUNDOS_DE_AVISO_DE_GAVETA * 1000);
    return () => window.clearTimeout(id);
  }, [apertura]);
  const mio = useQuery({
    queryKey: claveTurnoMio(usuarioId, sucursalId),
    queryFn: ({ signal }) => leerTurnoMio(signal),
    refetchInterval: sondeo,
  });

  if (cerrada) return <CajaCerrada reporte={cerrada} onListo={() => setCerrada(null)} />;

  if (mio.isPending) {
    return (
      <Pagina titulo="Caja">
        <EsqueletoDeLista etiqueta="Cargando tu caja" conInicial filas={3} />
      </Pagina>
    );
  }
  if (mio.isError && mio.data === undefined) {
    return (
      <Pagina titulo="Caja">
        <ErrorDeCarga
          titulo="No pudimos cargar tu caja"
          onReintentar={() => void mio.refetch()}
          reintentando={mio.isFetching}
        >
          {mensajeDeCaja(mio.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  if (mio.data) {
    return (
      <MiTurno
        turno={mio.data}
        aperturaImpresa={apertura?.id === mio.data.id ? apertura : undefined}
        onCerrada={(reporte) => {
          setCerrada(reporte);
        }}
      />
    );
  }
  return (
    <AbrirCaja
      empresaId={empresaId}
      usuarioId={usuarioId}
      sucursalId={sucursalId}
      esAdministrador={esAdministrador}
      suspendida={suspendida}
      onAbierta={setApertura}
    />
  );
}
