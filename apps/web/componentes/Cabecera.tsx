import Image from 'next/image';
import type { TramoHorario } from '@restaurante/dominio';
import { esImagenOptimizable } from '@/lib/imagenes';
import { DatoDeHorario } from './DatoDeHorario';
import { Icono } from './Iconos';

interface Props {
  nombre: string;
  logoUrl: string | null;
  /** Nombre de la sucursal (debajo del nombre de la empresa). */
  sucursal?: string;
  /** No se repite en el modo mesa: el cliente ya está en el local. */
  direccion?: string;
  horario?: readonly TramoHorario[];
  /** Solo en el modo mesa: "Mesa 4". */
  mesa?: string;
}

/**
 * La firma del restaurante: su logo, su nombre y su color (criterio 81). El `h1` es el nombre; la sucursal va
 * debajo y los datos (mesa, horario) en etiquetas blancas.
 */
export function Cabecera({ nombre, logoUrl, sucursal, direccion, horario, mesa }: Props) {
  const hayHorario = horario !== undefined && horario.length > 0;
  return (
    <header className="cabecera">
      <div className="cabecera__contenido">
        <div className="cabecera__marca">
          {esImagenOptimizable(logoUrl) ? (
            <div className="logo">
              <Image src={logoUrl} alt="" width={48} height={48} loading="eager" />
            </div>
          ) : null}
          <div>
            <h1>{nombre}</h1>
            {sucursal ? <p className="cabecera__sucursal">{sucursal}</p> : null}
          </div>
        </div>
        {direccion ? <p className="cabecera__direccion">{direccion}</p> : null}
        {mesa || hayHorario ? (
          <div className="cabecera__estados">
            {mesa ? (
              <p className="dato">
                <Icono nombre="mesa" />
                {mesa}
              </p>
            ) : null}
            {hayHorario ? <DatoDeHorario horario={horario} /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
