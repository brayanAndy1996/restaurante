import { EtiquetaDeEstado, IconoOk } from '@restaurante/ui';
import { useState } from 'react';
import type { MarcaEnLaCarta } from './carta-web';

interface Props {
  nombre: string;
  logoUrl: string | null;
  marca: MarcaEnLaCarta;
}

/**
 * Cómo se verá la marca en la carta: el encabezado con el logo y el nombre, y un botón de acción, ambos con el
 * color elegido y con las letras (blancas u oscuras) que de verdad llevará la carta web, más una opción marcada con
 * el color de los indicadores sobre blanco. Los colores salen de `colorDeMarcaAccesible` y `colorDeMarcaSobreBlanco`
 * de `packages/dominio`, los mismos que usa `apps/web`; aquí solo se pintan. Va con su resumen en palabras: el color
 * nunca es la única señal.
 */
export function MuestraDeMarca({ nombre, logoUrl, marca }: Props) {
  const [logoRoto, setLogoRoto] = useState<string | null>(null);
  const estilo = { background: marca.fondo, color: marca.texto };
  return (
    <figure className="muestra" aria-label="Muestra de tu carta con este color">
      <div className="muestra__encabezado" style={estilo}>
        {logoUrl && logoUrl !== logoRoto ? (
          <img
            className="muestra__logo"
            src={logoUrl}
            alt=""
            decoding="async"
            onError={() => setLogoRoto(logoUrl)}
          />
        ) : null}
        <span className="muestra__nombre">{nombre.trim() || 'Tu restaurante'}</span>
      </div>
      <div className="muestra__cuerpo">
        <span className="muestra__boton" style={estilo}>
          Enviar al mozo
        </span>
        <span className="muestra__opcion">
          <span
            className="muestra__punto"
            style={{ borderColor: marca.indicador, background: marca.indicador }}
            aria-hidden="true"
          />
          Opción elegida
        </span>
        <span className="muestra__nota">
          <EtiquetaDeEstado tono="ok" icono={IconoOk}>
            Se lee bien
          </EtiquetaDeEstado>
          <span className="texto-ayuda">
            Letras {marca.letras} sobre {marca.fondo}: contraste {marca.contraste}:1
          </span>
        </span>
      </div>
    </figure>
  );
}
