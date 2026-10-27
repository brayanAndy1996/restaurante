import {
  BannerDeEstado,
  Boton,
  IconoCandado,
  IconoEscudo,
  IconoReloj,
  IconoSinRed,
  type EstadoCenefa,
} from '@restaurante/ui';
import { useConexion } from '../lib/conexion';
import { fechaLarga, horaDeLima } from '../lib/formato';
import { useSesion } from '../modulos/acceso/sesion';

/**
 * Estado de la cenefa según la prioridad del diseño: sin conexión, modo soporte, sucursal suspendida,
 * suscripción en gracia y normal. Suspendida y gracia salen de `avisoSuscripcion` (solo lo recibe el
 * Administrador y el soporte).
 */
export function useEstadoDeCenefa(): EstadoCenefa {
  const { sinConexion } = useConexion();
  const { soporte, sesion } = useSesion();
  if (sinConexion) return 'sin-conexion';
  if (soporte) return 'soporte';
  const sucursales = sesion?.avisoSuscripcion?.sucursales ?? [];
  if (sucursales.some((s) => s.estado === 'SUSPENDIDA')) return 'suspendida';
  if (sucursales.some((s) => s.estado === 'EN_GRACIA')) return 'gracia';
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

const nombres = (lista: { nombre: string }[]) => lista.map((s) => s.nombre).join(', ');

/** "Quedan 5 días" / "Queda 1 día" / "Hoy es el último día". */
export function textoDeDiasDeGracia(dias: number | null): string {
  if (dias === null) return 'Queda poco tiempo';
  return dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`;
}

/**
 * Avisos de suscripción del Administrador (criterio 99): uno por sucursal suspendida y otro por las que
 * están en gracia. Son persistentes: no se pueden cerrar, y siempre aclaran que la suspensión solo
 * impide abrir caja (consultar, exportar y los turnos abiertos siguen funcionando).
 */
export function BannerDeSuscripcion() {
  const { sesion } = useSesion();
  const sucursales = sesion?.avisoSuscripcion?.sucursales ?? [];
  const suspendidas = sucursales.filter((s) => s.estado === 'SUSPENDIDA');
  const enGracia = sucursales.filter((s) => s.estado === 'EN_GRACIA');
  return (
    <>
      {suspendidas.length > 0 ? (
        <BannerDeEstado
          tono="rocoto"
          icono={IconoCandado}
          titulo={
            suspendidas.length === 1
              ? `${suspendidas[0]?.nombre}: sucursal suspendida`
              : `${suspendidas.length} sucursales suspendidas`
          }
        >
          {suspendidas.length > 1 ? `${nombres(suspendidas)}. ` : ''}
          No se puede abrir caja. Puedes consultar y exportar tus datos. Se reactiva al registrarse
          tu pago.
        </BannerDeEstado>
      ) : null}
      {enGracia.length > 0 ? (
        <BannerDeEstado
          tono="aji"
          icono={IconoReloj}
          titulo={
            enGracia.length === 1
              ? `${enGracia[0]?.nombre}: ${textoDeDiasDeGracia(enGracia[0]?.diasRestantesGracia ?? null).toLowerCase()} de gracia`
              : `${enGracia.length} sucursales en gracia`
          }
        >
          {enGracia.map((s) => (
            <span key={s.sucursalId} className="banner__linea">
              {enGracia.length > 1
                ? `${s.nombre}: ${textoDeDiasDeGracia(s.diasRestantesGracia).toLowerCase()}. `
                : ''}
              {`Se suspenderá el ${fechaLarga(s.suspensionDesde)}.`}
            </span>
          ))}
          <span className="banner__linea">La suspensión solo impide abrir caja.</span>
        </BannerDeEstado>
      ) : null}
    </>
  );
}
