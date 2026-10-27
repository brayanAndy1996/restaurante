import { Boton, IconoSalir } from '@restaurante/ui';
import { useSesion } from '../modulos/acceso/sesion';

/** Quién es el superadministrador y cómo salir del panel; vive en la barra de tinta oscura. */
export function BarraDePlataforma() {
  const { plataforma, salirDePlataforma } = useSesion();
  if (!plataforma) return null;
  return (
    <>
      <span className="ui-barra__quien">
        <b>{plataforma.superadministrador.nombre}</b>
        <span>Superadministrador</span>
      </span>
      <Boton variante="sobre-oscuro" icono={IconoSalir} onClick={() => void salirDePlataforma()}>
        Salir
      </Boton>
    </>
  );
}
