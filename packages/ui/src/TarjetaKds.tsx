import { EtiquetaDeEstado, type TonoEtiqueta } from './EtiquetaDeEstado';
import {
  Icono,
  IconoBloqueo,
  IconoDeshacer,
  IconoEsperar,
  IconoMarchar,
  IconoMas,
  IconoNota,
  IconoOk,
  IconoParaLlevar,
  IconoPendiente,
  IconoPreparando,
  IconoTodoListo,
  type LucideIcon,
} from './iconos';
import { minutosTranscurridos, nivelDeTiempo, Temporizador, textoDeMinutos } from './Temporizador';
import { clases } from './utilidades';

export type TipoDeComandaKds = 'COMANDA' | 'ADICION' | 'MARCHAR' | 'ANULACION';
export type EstadoDeLineaKds = 'ENVIADO' | 'EN_PREPARACION' | 'LISTO' | 'ANULADO';
/** Los estados que la cocina puede poner a una línea (`ANULADO` lo decide la anulación, no la pantalla). */
export type EstadoElegibleKds = Exclude<EstadoDeLineaKds, 'ANULADO'>;

/** Lo que la tarjeta necesita de una línea (los datos de `lineaKds` de `packages/contratos` encajan tal cual). */
export interface LineaDeTarjetaKds {
  id: string;
  cantidad: number;
  nombre: string;
  /** El combo o el producto del que sale la parte. */
  contexto: string | null;
  modificadores: readonly string[];
  observacion: string | null;
  esperar: boolean;
  paraLlevar: boolean;
  estado: EstadoDeLineaKds;
}

/** Cómo se dice y se pinta cada tipo de comanda: texto, icono y tono (nunca solo color). */
export const TIPO_DE_COMANDA_KDS: Record<
  TipoDeComandaKds,
  { texto: string; tono: TonoEtiqueta; icono: LucideIcon | undefined }
> = {
  COMANDA: { texto: 'Comanda', tono: 'neutro', icono: undefined },
  ADICION: { texto: 'Adición', tono: 'ok', icono: IconoMas },
  MARCHAR: { texto: 'Marchar', tono: 'alerta', icono: IconoMarchar },
  ANULACION: { texto: 'Anulación', tono: 'mal', icono: IconoBloqueo },
};

const LINEA_ABIERTA: readonly EstadoDeLineaKds[] = ['ENVIADO', 'EN_PREPARACION'];

/** `true` si a la comanda le queda algo por preparar (lo que decide si va a "pendientes"). */
export function tieneLineasAbiertas(lineas: readonly { estado: EstadoDeLineaKds }[]): boolean {
  return lineas.some((l) => LINEA_ABIERTA.includes(l.estado));
}

export interface PropsTarjetaKds {
  tipo: TipoDeComandaKds;
  /** "Mesa 4" o "Mesas 4 y 5". */
  mesa: string;
  mozo: string;
  comensales?: number;
  estacion: string;
  /** Cuándo llegó (texto ISO o ms de época) y la hora de ahora (ms), la del servidor. */
  creadaEn: string | number;
  ahora: number;
  /** El motivo de una anulación. */
  motivo?: string | null;
  lineas: readonly LineaDeTarjetaKds[];
  /** Llegó hace un momento: lleva la marca "Nueva" y un contorno. */
  nueva?: boolean;
  /** `reciente`: tarjeta compacta, sin el tiempo grande; solo deja corregir un "Listo". */
  modo?: 'pendiente' | 'reciente';
  /** Hay un cambio de esta comanda esperando la red. */
  esperandoRed?: boolean;
  alCambiarEstado?: (linea: LineaDeTarjetaKds, estado: EstadoElegibleKds) => void;
  alTodoListo?: () => void;
  alEnterado?: () => void;
}

/**
 * Tarjeta de una comanda del KDS: mesa, mozo, tipo y tiempo transcurrido arriba (se lee de lejos), cada línea
 * con todo su detalle y, abajo, la acción de la comanda. Botones de 56 px: se tocan con las manos ocupadas.
 *
 * - Comanda y adición: "Preparando" y "Listo" por línea y "Todo listo" para toda la comanda.
 * - Marchar y anulación: "Enterado" (la anulación dice el motivo y que no se prepare).
 * - Un "Listo" puesto por error se corrige con "Deshacer".
 */
export function TarjetaKds({
  tipo,
  mesa,
  mozo,
  comensales,
  estacion,
  creadaEn,
  ahora,
  motivo,
  lineas,
  nueva,
  modo = 'pendiente',
  esperandoRed,
  alCambiarEstado,
  alTodoListo,
  alEnterado,
}: PropsTarjetaKds) {
  const reciente = modo === 'reciente';
  const minutos = minutosTranscurridos(creadaEn, ahora);
  const nivel = reciente ? 'normal' : nivelDeTiempo(minutos);
  const info = TIPO_DE_COMANDA_KDS[tipo];
  const esDeCocina = tipo === 'COMANDA' || tipo === 'ADICION';
  // "Todo listo" no toca lo que espera la marcha: sin otra cosa por preparar, el botón no tiene nada que hacer.
  const quedaAlgo = tieneLineasAbiertas(lineas.filter((l) => !l.esperar));
  // Espacio duro entre el número y la palabra: a 360 px el conteo no se parte en dos renglones.
  const personas =
    comensales === undefined
      ? ''
      : ` · ${comensales}\u00a0${comensales === 1 ? 'comensal' : 'comensales'}`;

  return (
    <article
      className={clases(
        'ui-kds',
        `ui-kds--${tipo.toLowerCase()}`,
        `ui-kds--${nivel}`,
        reciente && 'ui-kds--reciente',
        nueva && 'ui-kds--nueva',
      )}
      aria-label={`${info.texto}, ${mesa}, ${estacion}`}
    >
      <header className="ui-kds__cabecera">
        <div className="ui-kds__titulo">
          <div className="ui-kds__marcas">
            <EtiquetaDeEstado tono={info.tono} {...(info.icono ? { icono: info.icono } : {})}>
              {info.texto}
            </EtiquetaDeEstado>
            {nueva ? <EtiquetaDeEstado tono="info">Nueva</EtiquetaDeEstado> : null}
            {esperandoRed ? (
              <EtiquetaDeEstado tono="alerta" icono={IconoPendiente}>
                Pendiente de envío
              </EtiquetaDeEstado>
            ) : null}
          </div>
          <h3 className="ui-kds__mesa">{mesa}</h3>
          <p className="ui-kds__ayuda">
            {mozo}
            {personas} · {estacion}
          </p>
        </div>
        {reciente ? (
          <span className="ui-kds__hace">Hace {textoDeMinutos(minutos)}</span>
        ) : (
          <Temporizador desde={creadaEn} ahora={ahora} />
        )}
      </header>

      {tipo === 'ANULACION' ? (
        <p className="ui-kds__anulacion">
          <b>No lo prepares.</b>
          {motivo ? <span> Motivo: {motivo}</span> : null}
        </p>
      ) : null}
      {tipo === 'MARCHAR' ? (
        <p className="ui-kds__marchar">
          <b>Marchar:</b> sacar ahora el segundo tiempo.
        </p>
      ) : null}

      <ul className="ui-kds__lineas">
        {lineas.map((linea) => (
          <LineaDeKds
            key={linea.id}
            linea={linea}
            deCocina={esDeCocina}
            reciente={reciente}
            {...(alCambiarEstado ? { alCambiarEstado } : {})}
          />
        ))}
      </ul>

      {!reciente && esDeCocina && quedaAlgo && alTodoListo ? (
        <button
          type="button"
          className="ui-boton ui-boton--principal ui-boton--bloque ui-kds__pie"
          aria-label={`Todo listo, ${mesa}`}
          onClick={alTodoListo}
        >
          <Icono icono={IconoTodoListo} tamano={20} />
          Todo listo
        </button>
      ) : null}
      {!reciente && !esDeCocina && alEnterado ? (
        <button
          type="button"
          className="ui-boton ui-boton--principal ui-boton--bloque ui-kds__pie"
          aria-label={`Enterado, ${mesa}`}
          onClick={alEnterado}
        >
          <Icono icono={IconoOk} tamano={20} />
          Enterado
        </button>
      ) : null}
      {reciente && !esDeCocina ? (
        <p className="ui-kds__ayuda">
          <EtiquetaDeEstado tono="ok" icono={IconoOk}>
            Enterado
          </EtiquetaDeEstado>
        </p>
      ) : null}
    </article>
  );
}

interface PropsLinea {
  linea: LineaDeTarjetaKds;
  deCocina: boolean;
  reciente: boolean;
  alCambiarEstado?: (linea: LineaDeTarjetaKds, estado: EstadoElegibleKds) => void;
}

function LineaDeKds({ linea, deCocina, reciente, alCambiarEstado }: PropsLinea) {
  const anulada = linea.estado === 'ANULADO';
  const lista = linea.estado === 'LISTO';
  const preparando = linea.estado === 'EN_PREPARACION';
  const conBotones = deCocina && !reciente && alCambiarEstado && !anulada && !lista;
  return (
    <li
      className={clases(
        'ui-kds__linea',
        lista && 'ui-kds__linea--lista',
        anulada && 'ui-kds__linea--anulada',
      )}
    >
      <span className="ui-kds__cantidad">{linea.cantidad} ×</span>
      <div className="ui-kds__detalle">
        <div className="ui-kds__nombre-fila">
          <span className="ui-kds__nombre">{linea.nombre}</span>
          {lista ? (
            <EtiquetaDeEstado tono="ok" icono={IconoOk}>
              Listo
            </EtiquetaDeEstado>
          ) : null}
          {anulada ? <EtiquetaDeEstado tono="mal">Anulado</EtiquetaDeEstado> : null}
        </div>
        {linea.contexto ? <span className="ui-kds__contexto">{linea.contexto}</span> : null}
        {linea.modificadores.length > 0 ? (
          <ul className="ui-kds__modificadores" aria-label="Modificadores">
            {linea.modificadores.map((m, i) => (
              <li key={`${i}-${m}`}>{m}</li>
            ))}
          </ul>
        ) : null}
        {linea.observacion ? (
          <p className="ui-kds__observacion">
            <Icono icono={IconoNota} tamano={20} />
            <span>
              <b>Nota:</b> {linea.observacion}
            </span>
          </p>
        ) : null}
        {linea.esperar || linea.paraLlevar ? (
          <div className="ui-kds__banderas">
            {linea.esperar ? (
              <span className="ui-kds__bandera ui-kds__bandera--esperar">
                <Icono icono={IconoEsperar} tamano={20} />
                Esperar
              </span>
            ) : null}
            {linea.paraLlevar ? (
              <span className="ui-kds__bandera ui-kds__bandera--llevar">
                <Icono icono={IconoParaLlevar} tamano={20} />
                Para llevar
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {conBotones ? (
        <div className="ui-kds__acciones">
          <button
            type="button"
            className="ui-boton ui-kds__accion"
            aria-pressed={preparando}
            aria-label={`Preparando: ${linea.nombre}`}
            // Ya está en preparación: el botón queda marcado y no hace nada (corregir se hace desde "Listo").
            onClick={() => {
              if (!preparando) alCambiarEstado(linea, 'EN_PREPARACION');
            }}
          >
            <Icono icono={preparando ? IconoOk : IconoPreparando} tamano={20} />
            Preparando
          </button>
          <button
            type="button"
            className="ui-boton ui-kds__accion"
            aria-label={`Listo: ${linea.nombre}`}
            onClick={() => alCambiarEstado(linea, 'LISTO')}
          >
            <Icono icono={IconoOk} tamano={20} />
            Listo
          </button>
        </div>
      ) : null}
      {lista && deCocina && alCambiarEstado ? (
        <button
          type="button"
          className="ui-boton ui-boton--texto ui-kds__deshacer"
          aria-label={`Deshacer el listo: ${linea.nombre}`}
          onClick={() => alCambiarEstado(linea, 'ENVIADO')}
        >
          <Icono icono={IconoDeshacer} tamano={20} />
          Deshacer
        </button>
      ) : null}
    </li>
  );
}
