import type { CajaRespuesta, ImpresoraRespuesta } from '@restaurante/contratos';
import { Aviso, CampoSeleccion, CampoTexto } from '@restaurante/ui';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import {
  CAMPOS_DE_SERIE,
  NOMBRE_DE_TIPO,
  PREFIJO_DE_TIPO,
  TIPOS,
  accionDeSerie,
  serieActiva,
  serieEscrita,
  textoDeUltimoNumero,
  type BorradorDeCaja,
  type ErroresDeCaja,
  type TipoSerie,
} from './cajas';

interface Props {
  /** Id del `<form>`: el botón fijo de abajo lo envía con `form=`. */
  formId: string;
  titulo: string;
  borrador: BorradorDeCaja;
  errores: ErroresDeCaja;
  /** La caja que se edita; sin ella, la caja es nueva. */
  caja?: CajaRespuesta | undefined;
  /** Impresoras de la sucursal (la caja elige entre las activas). */
  impresoras: readonly ImpresoraRespuesta[];
  /** Aviso general (por ejemplo, un error del servidor). */
  general?: { titulo: string; mensaje: string } | undefined;
  onCambio: (parcial: Partial<BorradorDeCaja>) => void;
  onEnviar: () => void;
  /** Acciones al final (desactivar o reactivar). */
  children?: ReactNode;
  /** Pone el cursor en el nombre al abrir (al crear, que es lo primero que se escribe). */
  enfocarNombre?: boolean;
}

/**
 * Datos de una caja (criterios 1 a 3 y 117): nombre, impresora y la serie de boletas y la de facturas. "Primer
 * número" solo aparece al escribir una serie nueva: una serie que ya se usa no cambia de número.
 */
export function FormularioDeCaja({
  formId,
  titulo,
  borrador,
  errores,
  caja,
  impresoras,
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

  // Las activas, y la de la caja aunque se haya desactivado después, para que el selector diga la verdad.
  const elegible = impresoras.filter((i) => i.activa || i.id === caja?.impresora?.id);

  return (
    <form
      ref={raiz}
      id={formId}
      className="formulario caja__formulario"
      onSubmit={enviar}
      noValidate
      aria-labelledby={`${formId}-titulo`}
    >
      <h3 className="formulario__titulo" id={`${formId}-titulo`}>
        {titulo}
      </h3>
      {general ? (
        <Aviso tipo="error" titulo={general.titulo}>
          {general.mensaje}
        </Aviso>
      ) : null}

      <CampoTexto
        etiqueta="Nombre de la caja"
        value={borrador.nombre}
        onChange={(e) => onCambio({ nombre: e.target.value })}
        error={errores.nombre}
        autoComplete="off"
        enterKeyHint="next"
        maxLength={40}
        placeholder="Por ejemplo, Caja 1"
        ayuda="Es el que verá el cajero al abrir su turno."
      />

      <CampoSeleccion
        etiqueta="Impresora de la caja"
        value={borrador.impresoraId}
        onChange={(e) => onCambio({ impresoraId: e.target.value })}
        error={errores.impresoraId}
        ayuda="Imprime el ticket y los reportes de esta caja y abre su gaveta."
      >
        <option value="">La de caja de la sucursal</option>
        {elegible.map((i) => (
          <option key={i.id} value={i.id}>
            {i.activa ? i.nombre : `${i.nombre} (inactiva)`}
          </option>
        ))}
      </CampoSeleccion>

      {TIPOS.map((tipo) => (
        <GrupoDeSerie
          key={tipo}
          tipo={tipo}
          borrador={borrador}
          errores={errores}
          caja={caja}
          onCambio={onCambio}
        />
      ))}

      {children}
    </form>
  );
}

interface PropsSerie {
  tipo: TipoSerie;
  borrador: BorradorDeCaja;
  errores: ErroresDeCaja;
  caja: CajaRespuesta | undefined;
  onCambio: (parcial: Partial<BorradorDeCaja>) => void;
}

/** La serie de un tipo de comprobante y, solo si es una serie nueva, el número con que empieza. */
function GrupoDeSerie({ tipo, borrador, errores, caja, onCambio }: PropsSerie) {
  const { serie: campoSerie, primero: campoPrimero } = CAMPOS_DE_SERIE[tipo];
  const nombre = NOMBRE_DE_TIPO[tipo];
  const prefijo = PREFIJO_DE_TIPO[tipo];
  const escrita = serieEscrita(borrador[campoSerie]);
  const actual = caja ? serieActiva(caja, tipo) : undefined;
  const accion = accionDeSerie(caja, tipo, escrita);
  const prefijoValido = new RegExp(`^${prefijo}[A-Z0-9]{3}$`).test(escrita);
  // Mientras la serie no está completa ("B0") todavía no se sabe si es nueva: no se pide el número.
  const pideNumero = accion === 'nueva' && prefijoValido;

  let ayuda: string;
  if (actual && accion === 'nada') ayuda = textoDeUltimoNumero(actual);
  else if (actual && accion === 'reactivar') {
    ayuda = `Ya se usó en esta caja: sigue donde se quedó. La serie ${actual.serie} deja de emitir y conserva su último número.`;
  } else if (actual && prefijoValido) {
    ayuda = `La serie ${actual.serie} deja de emitir en esta caja y conserva su último número.`;
  } else {
    ayuda = `Empieza con ${prefijo} y tiene 4 caracteres, por ejemplo ${prefijo}001. Déjala vacía si esta caja no emite ${nombre.singular}.`;
  }

  return (
    <div className="caja__serie" role="group" aria-labelledby={`caja-serie-${tipo}`}>
      <h4 className="caja__serie-titulo" id={`caja-serie-${tipo}`}>
        {nombre.plural}
      </h4>
      <div className={pideNumero ? 'caja__serie-campos caja__serie-campos--dos' : ''}>
        <CampoTexto
          etiqueta={`Serie de ${nombre.singular}`}
          value={borrador[campoSerie]}
          onChange={(e) => onCambio({ [campoSerie]: serieEscrita(e.target.value) })}
          error={errores[campoSerie]}
          ayuda={ayuda}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={4}
          placeholder={`${prefijo}001`}
        />
        {pideNumero ? (
          <CampoTexto
            etiqueta="Primer número"
            opcional
            value={borrador[campoPrimero]}
            onChange={(e) => onCambio({ [campoPrimero]: e.target.value })}
            error={errores[campoPrimero]}
            ayuda="El primero que se emitirá. Si ya usaste esta serie en otro sistema, escribe el que sigue allí. Vacío, empieza en 1."
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={8}
            placeholder="1"
          />
        ) : null}
      </div>
    </div>
  );
}
