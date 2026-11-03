import type { ReactNode } from 'react';
import type { AvisoDeMesa } from '@/lib/llamados';
import { Icono } from '../Iconos';

/**
 * Un aviso del modo mesa: icono, título en negrita y una frase, con el color que acompaña al estado (nunca solo el
 * color: el icono y las palabras dicen lo mismo). `role="alert"` para los errores de un envío y `status` para los
 * estados, así el lector de pantalla los anuncia.
 */
export function Aviso({ aviso, accion }: { aviso: AvisoDeMesa; accion?: ReactNode }) {
  return (
    <div className={`aviso aviso--${aviso.tono}`} role={aviso.rol}>
      <Icono nombre={aviso.icono} />
      <div className="aviso__cuerpo">
        <p className="aviso__titulo">{aviso.titulo}</p>
        {aviso.texto ? <p className="aviso__texto">{aviso.texto}</p> : null}
      </div>
      {accion}
    </div>
  );
}
