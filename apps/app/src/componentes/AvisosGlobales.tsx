import {
  BannerDeEstado,
  Boton,
  IconoEscudo,
  IconoSinRed,
  type EstadoCenefa,
} from '@restaurante/ui';
import { useConexion } from '../lib/conexion';
import { horaDeLima } from '../lib/formato';
import { useSesion } from '../modulos/acceso/sesion';

/** Estado de la cenefa según la prioridad: sin conexión, soporte, y normal (T42 suma suspendida y gracia). */
export function useEstadoDeCenefa(): EstadoCenefa {
  const { sinConexion } = useConexion();
  const { soporte } = useSesion();
  if (sinConexion) return 'sin-conexion';
  if (soporte) return 'soporte';
  return 'normal';
}

function textoDeCambios(n: number): string {
  return n === 1 ? '1 cambio' : `${n} cambios`;
}

/** Banner de "Sin conexión" / "Enviando N cambios…": siempre dice con palabras lo que pasa. */
export function BannerDeConexion() {
  const { sinConexion, pendientes } = useConexion();
  if (sinConexion) {
    return (
      <BannerDeEstado tono="aji" icono={IconoSinRed} titulo="Sin conexión">
        Lo que escribas se conservará y se enviará al volver.
        {pendientes > 0 ? ` ${textoDeCambios(pendientes)} por enviar.` : ''}
      </BannerDeEstado>
    );
  }
  if (pendientes > 0) {
    return (
      <BannerDeEstado
        tono="aji"
        icono={IconoSinRed}
        titulo={`Enviando ${textoDeCambios(pendientes)}…`}
      >
        La conexión volvió. No cierres esta pantalla.
      </BannerDeEstado>
    );
  }
  return null;
}

/** Banner fijo del modo soporte: quién da soporte, a quién, y cómo terminarlo. */
export function BannerDeSoporte() {
  const { soporte, sesion, terminarSoporte } = useSesion();
  if (!soporte) return null;
  const quien = sesion?.superadministrador?.nombre ?? 'Soporte';
  const hasta = horaDeLima(new Date(Date.parse(soporte.iniciadoEn) + 2 * 60 * 60 * 1000));
  return (
    <BannerDeEstado
      tono="soporte"
      icono={IconoEscudo}
      titulo={`Soporte en ${soporte.empresaNombre}`}
      accion={
        <Boton variante="sobre-oscuro" onClick={() => void terminarSoporte()}>
          Terminar
        </Boton>
      }
    >
      {`${quien} · hasta las ${hasta}`}
    </BannerDeEstado>
  );
}
