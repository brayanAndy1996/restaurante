import { Boton, Icono, IconoAvisoDeListo, IconoOk } from '@restaurante/ui';
import { quitarAviso, quitarTodosLosAvisos, useAvisosDeListo } from '../../lib/avisos-de-listo';
import { horaDeLima } from '../../lib/formato';
import './avisos.css';

/**
 * "Avisos" del salón (criterio 98 de 004): los "Listo" de la cocina que esperan a su mozo. Cada aviso se queda
 * hasta que se toca. Solo aparece cuando hay alguno, arriba del mapa, donde se ve al entrar.
 */
export function ListaDeAvisos() {
  const avisos = useAvisosDeListo();
  if (avisos.length === 0) return null;
  return (
    <section className="avisos" aria-labelledby="avisos-titulo">
      <div className="avisos__cabecera">
        <h2 className="avisos__titulo" id="avisos-titulo">
          Avisos
        </h2>
        {avisos.length > 1 ? (
          <Boton variante="texto" onClick={quitarTodosLosAvisos}>
            Quitar todos
          </Boton>
        ) : null}
      </div>
      <ul className="avisos__lista">
        {avisos.map((aviso) => (
          <li key={aviso.id}>
            <button
              type="button"
              className="avisos__fila"
              aria-label={`${aviso.texto}. Toca para quitar el aviso.`}
              onClick={() => quitarAviso(aviso.id)}
            >
              <Icono icono={IconoAvisoDeListo} />
              <span className="avisos__texto">
                <b>{aviso.texto}</b>
                <span className="avisos__hora">
                  Listo a las {horaDeLima(new Date(aviso.recibidoEn))} · Toca para quitar
                </span>
              </span>
              <Icono icono={IconoOk} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
