import { useEffect, useRef } from 'react';
import { tokenDeSesion } from '../../lib/almacen';
import { recordarEsteEquipo } from '../../lib/equipo';
import { useSesion } from './sesion';

/**
 * Después de ingresar con contraseña (y de cambiar la contraseña temporal), el equipo recuerda a la
 * persona sin pedirle nada (criterio 93): llama a `POST /sesion/equipo`, guarda el token si llega uno
 * nuevo y relee la sesión para que "Cambiar usuario" y "Olvidar este equipo" aparezcan. Se intenta una
 * sola vez por sesión; si falla (sin red, por ejemplo), la persona sigue trabajando y la próxima vez
 * ingresará de nuevo con su contraseña. No dibuja nada.
 */
export function RecordarEquipoAutomatico() {
  const { sesion, releer } = useSesion();
  const intentada = useRef<string | null>(null);
  const aplicable =
    sesion !== null &&
    sesion.tipo === 'CONTRASENA' &&
    !sesion.debeCambiarContrasena &&
    sesion.equipo === null;
  const empresaId = sesion?.empresaId;

  useEffect(() => {
    if (!aplicable || !empresaId) return;
    const token = tokenDeSesion();
    if (!token || intentada.current === token) return;
    intentada.current = token;
    recordarEsteEquipo(empresaId)
      .then(() => releer({ segundoPlano: true }))
      .catch(() => undefined);
  }, [aplicable, empresaId, releer]);

  return null;
}
