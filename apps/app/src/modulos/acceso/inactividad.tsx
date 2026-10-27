import { BannerDeEstado, Boton, IconoReloj } from '@restaurante/ui';
import { useEffect, useRef, useState } from 'react';
import { ahoraDelServidor } from '../../lib/api';
import { relojDeCuenta } from '../../lib/formato';
import { useSesion } from './sesion';

/** Segundos antes del cierre en que se avisa ("sesión por vencer"). */
export const SEGUNDOS_DE_AVISO = 30;
/** Cada cuánto, como máximo, una interacción renueva la inactividad en el servidor. */
const RENOVAR_CADA_MS = 20_000;
/** Cada cuánto se confirma la sesión con el servidor sin renovarla (detecta revocaciones). */
const SINCRONIZAR_CADA_MS = 60_000;
/** El superadministrador no tiene inactividad en el servidor: la PWA lo cierra tras 30 minutos sin uso. */
export const MINUTOS_DE_PLATAFORMA = 30;

const EVENTOS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Llama a `alInteractuar` con cada toque o tecla de la persona. Los oyentes son pasivos. */
function useInteraccion(alInteractuar: () => void, activo: boolean): void {
  const ultimo = useRef(alInteractuar);
  useEffect(() => {
    ultimo.current = alInteractuar;
  });
  useEffect(() => {
    if (!activo) return;
    const oyente = () => ultimo.current();
    EVENTOS.forEach((e) => window.addEventListener(e, oyente, { passive: true, capture: true }));
    return () => EVENTOS.forEach((e) => window.removeEventListener(e, oyente, { capture: true }));
  }, [activo]);
}

/**
 * Cierre por inactividad de la sesión de empresa (criterio 96). Manda el servidor: el plazo sale de
 * `expiraPorInactividadEn`, medido con la hora del servidor (no con el reloj del celular). Cada
 * interacción renueva el plazo con `GET /sesion`; las consultas de fondo (`X-Actividad:
 * segundo-plano`) solo confirman que la sesión sigue viva. Treinta segundos antes del cierre aparece
 * el aviso "sesión por vencer", y antes de cerrar se vuelve a preguntar al servidor.
 */
export function VigilanteDeInactividad() {
  const { sesion, releer, salir } = useSesion();
  const venceEn = sesion?.expiraPorInactividadEn ? Date.parse(sesion.expiraPorInactividadEn) : null;
  const [restante, setRestante] = useState<number | null>(null);
  const renovando = useRef(false);
  const ultimaRenovacion = useRef(0);
  const cerrando = useRef(false);

  async function renovar() {
    if (renovando.current) return;
    renovando.current = true;
    ultimaRenovacion.current = Date.now();
    try {
      await releer();
    } catch {
      // Un 401 ya cerró la sesión; un corte de red lo muestra la cenefa y se reintenta con la próxima interacción.
    } finally {
      renovando.current = false;
    }
  }

  useInteraccion(() => {
    const porVencer = restante !== null && restante <= SEGUNDOS_DE_AVISO;
    if (porVencer || Date.now() - ultimaRenovacion.current > RENOVAR_CADA_MS) void renovar();
  }, venceEn !== null);

  // Reloj de un segundo: calcula lo que falta y, al llegar a cero, confirma con el servidor. Si nadie
  // más renovó la sesión (su plazo no se movió), se cierra aquí mismo: en un celular compartido la
  // pantalla no debe seguir a la vista de otra persona. Sin conexión para confirmar, también se cierra.
  useEffect(() => {
    if (venceEn === null) return;
    const medir = () => {
      const faltan = (venceEn - ahoraDelServidor()) / 1000;
      setRestante(faltan);
      if (faltan <= 0 && !cerrando.current) {
        cerrando.current = true;
        releer({ segundoPlano: true })
          .then((nueva) => {
            const renovada =
              nueva?.expiraPorInactividadEn && Date.parse(nueva.expiraPorInactividadEn) > venceEn;
            if (renovada) cerrando.current = false;
            else void salir('inactividad');
          })
          .catch(() => void salir('inactividad'));
      }
    };
    medir();
    const reloj = setInterval(medir, 1000);
    return () => clearInterval(reloj);
  }, [venceEn, releer, salir]);

  // Confirmación de fondo cada minuto: sin renovar, para notar una sesión revocada o con otro plazo.
  useEffect(() => {
    if (venceEn === null) return;
    const sincronizar = setInterval(() => {
      releer({ segundoPlano: true }).catch(() => undefined);
    }, SINCRONIZAR_CADA_MS);
    return () => clearInterval(sincronizar);
  }, [venceEn, releer]);

  if (restante === null || restante > SEGUNDOS_DE_AVISO || restante <= 0) return null;
  return (
    <>
      <span role="status" className="ui-solo-lectores">
        Tu sesión se cerrará pronto por inactividad.
      </span>
      <BannerDeEstado
        tono="aji"
        icono={IconoReloj}
        rol="timer"
        titulo={`Tu sesión se cerrará en ${relojDeCuenta(restante)}`}
        accion={
          <Boton onClick={() => void renovar()} className="ui-boton--bloque">
            Seguir trabajando
          </Boton>
        }
      >
        Por seguridad, se cierra cuando no la usas.
      </BannerDeEstado>
    </>
  );
}

/** Cierre por inactividad del panel de plataforma: 30 minutos sin interacción, solo en la PWA. */
export function VigilanteDePlataforma() {
  const { salirDePlataforma } = useSesion();
  const ultimaInteraccion = useRef(Date.now());
  useInteraccion(() => {
    ultimaInteraccion.current = Date.now();
  }, true);
  useEffect(() => {
    const reloj = setInterval(() => {
      if (Date.now() - ultimaInteraccion.current >= MINUTOS_DE_PLATAFORMA * 60_000) {
        void salirDePlataforma('inactividad');
      }
    }, 5000);
    return () => clearInterval(reloj);
  }, [salirDePlataforma]);
  return null;
}
