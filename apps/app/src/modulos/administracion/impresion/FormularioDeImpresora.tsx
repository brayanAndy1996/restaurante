import { ANCHOS_PAPEL_MM, JUEGOS_CARACTERES } from '@restaurante/contratos';
import {
  Aviso,
  CampoSeleccion,
  CampoTexto,
  Interruptor,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import {
  NOTA_DE_BLUETOOTH,
  TEXTO_DE_JUEGO,
  textoDeColumnas,
  type BorradorDeImpresora,
  type ErroresDeImpresora,
} from './impresion';

const CONEXIONES: readonly OpcionDeSegmento<BorradorDeImpresora['tipo']>[] = [
  { valor: 'RED', etiqueta: 'Red' },
  { valor: 'BLUETOOTH', etiqueta: 'Bluetooth' },
];

type ValorDeAncho = '58' | '80';

const ANCHOS: readonly OpcionDeSegmento<ValorDeAncho>[] = ANCHOS_PAPEL_MM.map((ancho) => ({
  valor: ancho === 58 ? '58' : '80',
  etiqueta: `${ancho} mm`,
}));

interface Props {
  /** Id del `<form>`: el botón fijo de abajo lo envía con `form=`. */
  formId: string;
  titulo: string;
  borrador: BorradorDeImpresora;
  errores: ErroresDeImpresora;
  /** Aviso general (por ejemplo, un error del servidor). */
  general?: string | undefined;
  onCambio: (parcial: Partial<BorradorDeImpresora>) => void;
  onEnviar: () => void;
  /** Acciones al final (desactivar o reactivar). */
  children?: ReactNode;
  /** Pone el cursor en el nombre al abrir (al crear, que es lo primero que se escribe). */
  enfocarNombre?: boolean;
}

/**
 * Datos de una impresora (criterios 103 y 136): nombre, cómo se conecta (red o Bluetooth), ancho del
 * papel, juego de caracteres y gaveta.
 */
export function FormularioDeImpresora({
  formId,
  titulo,
  borrador,
  errores,
  general,
  onCambio,
  onEnviar,
  children,
  enfocarNombre,
}: Props) {
  const raiz = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (enfocarNombre) raiz.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [enfocarNombre]);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    onEnviar();
  }

  return (
    <form
      ref={raiz}
      id={formId}
      className="formulario impresion__formulario"
      onSubmit={enviar}
      noValidate
      aria-labelledby={`${formId}-titulo`}
    >
      <h3 className="formulario__titulo" id={`${formId}-titulo`}>
        {titulo}
      </h3>
      {general ? (
        <Aviso tipo="error" titulo="No pudimos guardar la impresora">
          {general}
        </Aviso>
      ) : null}

      <CampoTexto
        etiqueta="Nombre de la impresora"
        value={borrador.nombre}
        onChange={(e) => onCambio({ nombre: e.target.value })}
        error={errores.nombre}
        autoComplete="off"
        enterKeyHint="next"
        maxLength={40}
        placeholder="Por ejemplo, Cocina o Caja"
        ayuda="Es el que verás al elegir dónde sale cada estación."
      />

      <div className="impresion__grupo">
        <p className="ui-campo__etiqueta">Cómo se conecta</p>
        <Segmentos
          etiqueta="Cómo se conecta la impresora"
          opciones={CONEXIONES}
          valor={borrador.tipo}
          onCambio={(tipo) => onCambio({ tipo })}
        />
      </div>

      {borrador.tipo === 'RED' ? (
        <div className="impresion__red">
          <CampoTexto
            etiqueta="Dirección de la impresora"
            value={borrador.host}
            onChange={(e) => onCambio({ host: e.target.value })}
            error={errores.host}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="192.168.1.50"
            ayuda="La IP fija de la impresora en la red del local."
          />
          <CampoTexto
            etiqueta="Puerto"
            value={borrador.puerto}
            onChange={(e) => onCambio({ puerto: e.target.value })}
            error={errores.puerto}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            ayuda="Casi todas usan 9100."
          />
        </div>
      ) : (
        <div className="impresion__grupo">
          <CampoTexto
            etiqueta="Dirección Bluetooth"
            value={borrador.mac}
            onChange={(e) => onCambio({ mac: e.target.value })}
            error={errores.mac}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="AA:BB:CC:DD:EE:FF"
            ayuda="Son 6 pares de letras y números."
          />
          <Aviso tipo="info" titulo={NOTA_DE_BLUETOOTH}>
            Puedes guardarla ya. Imprime cuando la app puente tenga Bluetooth; mientras tanto sus
            tickets esperan en la cola.
          </Aviso>
        </div>
      )}

      <div className="impresion__grupo">
        <p className="ui-campo__etiqueta">Ancho del papel</p>
        <Segmentos
          etiqueta="Ancho del papel"
          opciones={ANCHOS}
          valor={borrador.anchoMm === 58 ? '58' : '80'}
          onCambio={(ancho) => onCambio({ anchoMm: ancho === '58' ? 58 : 80 })}
        />
        <p className="texto-ayuda">{textoDeColumnas()}</p>
      </div>

      <CampoSeleccion
        etiqueta="Juego de caracteres"
        value={borrador.juegoCaracteres}
        onChange={(e) =>
          onCambio({ juegoCaracteres: e.target.value as BorradorDeImpresora['juegoCaracteres'] })
        }
        ayuda="Si salen símbolos raros en las tildes, prueba otro."
      >
        {JUEGOS_CARACTERES.map((juego) => (
          <option key={juego} value={juego}>
            {TEXTO_DE_JUEGO[juego]}
          </option>
        ))}
      </CampoSeleccion>

      <Interruptor
        etiqueta="Tiene gaveta"
        ayuda="Una gaveta de dinero conectada a esta impresora. Por ahora solo se guarda: se abrirá al cobrar."
        marcado={borrador.gaveta}
        onCambio={(gaveta) => onCambio({ gaveta })}
      />

      {children}
    </form>
  );
}
