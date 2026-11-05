import type { CuentaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  CampoMonto,
  CampoTexto,
  Hoja,
  SelectorDeCantidad,
  Segmentos,
  limpiarMontoEscrito,
} from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ContextoDeObjetivo } from '../../componentes/objetivo-de-clave';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { montoEnSoles } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import {
  ATAJOS_DE_CORTESIA,
  ATAJOS_DE_DESCUENTO,
  aplicarCortesia,
  aplicarDescuento,
  falloDeCuenta,
  objetivoDeCortesia,
  objetivoDeDescuento,
  sePuedeAjustar,
  textoDeDescuento,
  textoDeDescuentoRechazado,
  tituloDeCuenta,
  valorEscrito,
  vistaPrevia,
  type FalloDeCuenta,
} from './cuenta';
import { useAjusteConClave } from './useAjusteConClave';
import './cuenta-caja.css';

type Linea = CuentaRespuesta['lineas'][number];

/** Largo máximo del motivo (`motivoSchema`). */
const LARGO_MOTIVO = 300;

interface PropsAjuste {
  /** La cuenta tal como está ahora en pantalla. */
  cuenta: CuentaRespuesta;
  /** `null`: el descuento es para toda la cuenta. */
  linea: Linea | null;
  onCerrar: () => void;
  /** Se aplicó: lo que la cuenta le dice a la persona. */
  onHecho: (texto: string) => void;
}

function contextoDe(cuenta: CuentaRespuesta, linea: Linea | null): ContextoDeObjetivo {
  return {
    mesa: tituloDeCuenta(cuenta),
    ...(linea ? { itemNombre: linea.nombre, itemUnidades: linea.cantidad } : {}),
  };
}

/** Lo que ocurrió después de aplicar: se vuelve a leer la cuenta (versión, totales y pre-cuenta). */
function useRefresco(cuenta: CuentaRespuesta) {
  const clientes = useQueryClient();
  return () => {
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(cuenta.ordenId) });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
  };
}

function AcercaDeLaClave({ conClave, nota }: { conClave: boolean; nota: string | null }) {
  return (
    <>
      {conClave && !nota ? (
        <Aviso tipo="info" titulo="Hace falta la clave de un supervisor">
          Al tocar el botón, el supervisor verá exactamente lo que autoriza y pondrá su PIN en tu
          celular.
        </Aviso>
      ) : null}
      {nota ? (
        <Aviso tipo="info" titulo="Falta una clave nueva">
          {nota}
        </Aviso>
      ) : null}
    </>
  );
}

function MotivoDelAjuste({
  atajos,
  motivo,
  error,
  onCambio,
}: {
  atajos: readonly string[];
  motivo: string;
  error: string | undefined;
  onCambio: (motivo: string) => void;
}) {
  return (
    <div className="formulario__grupo">
      <Segmentos
        etiqueta="Motivos frecuentes"
        opciones={atajos.map((a) => ({ valor: a, etiqueta: a }))}
        valor={atajos.find((a) => a === motivo) ?? ''}
        onCambio={onCambio}
      />
      <CampoAreaTexto
        etiqueta="Motivo"
        value={motivo}
        onChange={(e) => onCambio(e.target.value)}
        error={error}
        maxLength={LARGO_MOTIVO}
        rows={1}
      />
    </div>
  );
}

function revisarMotivo(motivo: string): string | undefined {
  const limpio = motivo.trim();
  if (limpio === '') return 'Elige o escribe el motivo';
  if (Array.from(limpio).length > LARGO_MOTIVO) return `Usa ${LARGO_MOTIVO} caracteres como máximo`;
  return undefined;
}

// --- Descuento -----------------------------------------------------------------------------------------

/**
 * Hoja «Descuento» de un ítem o de toda la cuenta (criterios 38 a 41 y 111 de 006): el tipo (porcentaje o monto), el
 * valor, el motivo y la vista previa de cómo queda la cuenta. Con `clave`, la ventana del supervisor muestra el
 * objetivo exacto («Descuento 10 % · Lomo saltado × 2 · Mesa 4») y la clave solo sirve para eso; si la API dice
 * que ya no vale, la pide otra vez sin perder lo escrito.
 */
export function DescuentoHoja({ cuenta, linea, onCerrar, onHecho }: PropsAjuste) {
  const refrescar = useRefresco(cuenta);
  const ajuste = useAjusteConClave();
  const permiso = usePermiso('APLICAR_DESCUENTO');
  const [tipo, setTipo] = useState<'PORCENTAJE' | 'MONTO'>('PORCENTAJE');
  const [escrito, setEscrito] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<{ valor?: string; motivo?: string }>({});
  const [fallo, setFallo] = useState<FalloDeCuenta | null>(null);
  const [enviando, setEnviando] = useState(false);

  const valor = valorEscrito(escrito);
  const previa =
    valor === null
      ? null
      : vistaPrevia(cuenta, {
          tipo: 'DESCUENTO',
          itemId: linea?.itemId ?? null,
          descuento: { tipo, valor },
        });
  const rechazo = previa && !previa.ok ? previa : null;
  const errorDelValor =
    errores.valor ??
    (rechazo ? textoDeDescuentoRechazado(rechazo.codigo, rechazo.tipo, linea?.bruto) : undefined);
  const ajustable = sePuedeAjustar(cuenta);

  async function aplicar() {
    if (enviando || !ajustable) return;
    setFallo(null);
    const nuevos: { valor?: string; motivo?: string } = {};
    if (valor === null) {
      nuevos.valor =
        tipo === 'PORCENTAJE'
          ? 'Escribe el porcentaje, por ejemplo 10'
          : 'Escribe el monto, por ejemplo 5.00';
    }
    const falloMotivo = revisarMotivo(motivo);
    if (falloMotivo) nuevos.motivo = falloMotivo;
    setErrores(nuevos);
    if (valor === null || Object.keys(nuevos).length > 0 || rechazo) return;

    const motivoLimpio = motivo.trim();
    const itemId = linea?.itemId ?? null;
    const objetivo = objetivoDeDescuento(cuenta.ordenId, itemId, { tipo, valor });
    setEnviando(true);
    const resultado = await ajuste.ejecutar({
      accion: 'APLICAR_DESCUENTO',
      permiso,
      objetivo,
      contexto: contextoDe(cuenta, linea),
      motivo: motivoLimpio,
      huella: ['DESCUENTO', itemId, tipo, valor, motivoLimpio].join('|'),
      enviar: (id, extra) =>
        aplicarDescuento(cuenta.ordenId, { id, itemId, tipo, valor, motivo: motivoLimpio }, extra),
    });
    if (!ajuste.sigueMontada()) {
      if (resultado.estado === 'hecho') refrescar();
      return;
    }
    setEnviando(false);
    if (resultado.estado === 'cancelado') return;
    if (resultado.estado === 'hecho') {
      refrescar();
      onHecho(
        `Descuento de ${textoDeDescuento(tipo, valor)} aplicado a ${linea ? linea.nombre : 'toda la cuenta'}.`,
      );
      return;
    }
    if (resultado.error instanceof ErrorApi && resultado.error.estado >= 400) refrescar();
    const traducido = falloDeCuenta(resultado.error, {
      tipo,
      ...(linea ? { baseDelItem: linea.bruto } : {}),
    });
    if (traducido?.enElValor) setErrores({ valor: traducido.texto });
    else setFallo(traducido ?? { texto: mensajeDeError(resultado.error) });
  }

  const conClave = permiso === 'clave';
  return (
    <>
      <Hoja abierta onCerrar={onCerrar} titulo="Descuento" className="hoja-ajuste">
        <div className="formulario ajuste">
          {!ajustable ? (
            <Aviso tipo="alerta" titulo="Esta cuenta ya no admite descuentos">
              Ya tiene cobros o dejó de estar abierta. Cierra esta ventana y mira la cuenta.
            </Aviso>
          ) : null}

          <div className="ajuste__que">
            {linea ? (
              <>
                <b>{linea.nombre}</b>
                <span className="texto-ayuda">
                  {linea.cantidad} × · {montoEnSoles(linea.bruto)}
                </span>
              </>
            ) : (
              <>
                <b>Toda la cuenta</b>
                <span className="texto-ayuda">
                  {tituloDeCuenta(cuenta)} · Subtotal {montoEnSoles(cuenta.totales.subtotal)}
                </span>
              </>
            )}
          </div>

          <Segmentos
            etiqueta="Tipo de descuento"
            opciones={[
              { valor: 'PORCENTAJE', etiqueta: 'Porcentaje' },
              { valor: 'MONTO', etiqueta: 'Monto' },
            ]}
            valor={tipo}
            onCambio={(nuevo) => {
              setTipo(nuevo);
              setEscrito('');
              setErrores((e) => ({ ...e, valor: undefined }));
              setFallo(null);
            }}
          />
          {tipo === 'MONTO' ? (
            <CampoMonto
              etiqueta="Monto del descuento"
              value={escrito}
              onValor={(v) => {
                setEscrito(v);
                setErrores((e) => ({ ...e, valor: undefined }));
              }}
              error={errorDelValor}
              disabled={enviando}
            />
          ) : (
            <CampoTexto
              etiqueta="Porcentaje del descuento"
              ayuda="De 0.01 a 99.99. Para no cobrar nada, usa «Cortesía»."
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              value={escrito}
              onChange={(e) => {
                setEscrito(limpiarMontoEscrito(e.target.value));
                setErrores((previos) => ({ ...previos, valor: undefined }));
              }}
              error={errorDelValor}
              disabled={enviando}
            />
          )}

          <div className="ajuste__previa" role="status" aria-live="polite">
            {previa && previa.ok ? (
              <>
                {previa.monto ? (
                  <span>
                    Descuenta <b>{montoEnSoles(previa.monto)}</b>
                  </span>
                ) : null}
                <span>
                  El total baja de {montoEnSoles(previa.totalAntes)} a{' '}
                  <b>{montoEnSoles(previa.totalDespues)}</b>
                </span>
              </>
            ) : null}
          </div>

          <MotivoDelAjuste
            atajos={ATAJOS_DE_DESCUENTO}
            motivo={motivo}
            error={errores.motivo}
            onCambio={(m) => {
              setMotivo(m);
              setErrores((e) => ({ ...e, motivo: undefined }));
            }}
          />

          <AcercaDeLaClave conClave={conClave} nota={ajuste.nota} />
          <div className="ajuste__pie">
            <AvisoPendiente pendiente={ajuste.pendiente} />
            {fallo ? (
              <Aviso tipo="error" titulo="No pudimos aplicar el descuento">
                {fallo.texto}
              </Aviso>
            ) : null}
            <Boton
              variante="principal"
              bloque
              cargando={enviando}
              textoCargando={ajuste.pendiente ? 'Pendiente de envío' : 'Aplicando…'}
              disabled={!ajustable}
              onClick={() => void aplicar()}
            >
              {conClave ? 'Pedir clave de supervisor' : 'Aplicar descuento'}
            </Boton>
          </div>
        </div>
      </Hoja>
      {ajuste.ventana}
    </>
  );
}

// --- Cortesía ------------------------------------------------------------------------------------------

/**
 * Hoja «Cortesía» de un ítem (criterios 43 y 111 de 006): cuántas unidades se regalan, el motivo y cómo queda el
 * total. Misma clave atada que el descuento, con `{ tipo: 'CORTESIA', ordenId, itemId, cantidad }`.
 */
export function CortesiaHoja({ cuenta, linea, onCerrar, onHecho }: PropsAjuste & { linea: Linea }) {
  const refrescar = useRefresco(cuenta);
  const ajuste = useAjusteConClave();
  const permiso = usePermiso('APLICAR_CORTESIA');
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [fallo, setFallo] = useState<FalloDeCuenta | null>(null);
  const [enviando, setEnviando] = useState(false);

  const previa = vistaPrevia(cuenta, { tipo: 'CORTESIA', itemId: linea.itemId, cantidad });
  const ajustable = sePuedeAjustar(cuenta);

  async function dar() {
    if (enviando || !ajustable) return;
    setFallo(null);
    const falloMotivo = revisarMotivo(motivo);
    setErrorMotivo(falloMotivo);
    if (falloMotivo) return;

    const motivoLimpio = motivo.trim();
    const objetivo = objetivoDeCortesia(cuenta.ordenId, linea.itemId, cantidad);
    setEnviando(true);
    const resultado = await ajuste.ejecutar({
      accion: 'APLICAR_CORTESIA',
      permiso,
      objetivo,
      contexto: contextoDe(cuenta, linea),
      motivo: motivoLimpio,
      huella: ['CORTESIA', linea.itemId, cantidad, motivoLimpio].join('|'),
      enviar: (id, extra) =>
        aplicarCortesia(
          cuenta.ordenId,
          { id, itemId: linea.itemId, cantidad, motivo: motivoLimpio },
          extra,
        ),
    });
    if (!ajuste.sigueMontada()) {
      if (resultado.estado === 'hecho') refrescar();
      return;
    }
    setEnviando(false);
    if (resultado.estado === 'cancelado') return;
    if (resultado.estado === 'hecho') {
      refrescar();
      onHecho(
        `Cortesía de ${cantidad === 1 ? '1 unidad' : `${cantidad} unidades`} de ${linea.nombre} registrada.`,
      );
      return;
    }
    if (resultado.error instanceof ErrorApi && resultado.error.estado >= 400) refrescar();
    setFallo(falloDeCuenta(resultado.error) ?? { texto: mensajeDeError(resultado.error) });
  }

  const conClave = permiso === 'clave';
  return (
    <>
      <Hoja abierta onCerrar={onCerrar} titulo="Cortesía" className="hoja-ajuste">
        <div className="formulario ajuste">
          {!ajustable ? (
            <Aviso tipo="alerta" titulo="Esta cuenta ya no admite cortesías">
              Ya tiene cobros o dejó de estar abierta. Cierra esta ventana y mira la cuenta.
            </Aviso>
          ) : null}

          <div className="ajuste__que">
            <b>{linea.nombre}</b>
            <span className="texto-ayuda">
              {linea.cantidad} {linea.cantidad === 1 ? 'unidad' : 'unidades'} en la cuenta ·{' '}
              {tituloDeCuenta(cuenta)}
            </span>
          </div>

          {linea.cantidad > 1 ? (
            <div className="ajuste__cantidad">
              <span className="ui-campo__etiqueta">Cuántas son cortesía</span>
              <SelectorDeCantidad
                nombre={linea.nombre}
                valor={cantidad}
                maximo={linea.cantidad}
                onCambio={setCantidad}
              />
            </div>
          ) : null}
          <p className="texto-ayuda">
            La cortesía no se cobra. Para descontar una parte, usa «Descuento».
          </p>

          <div className="ajuste__previa" role="status" aria-live="polite">
            {previa && previa.ok ? (
              <span>
                El total baja de {montoEnSoles(previa.totalAntes)} a{' '}
                <b>{montoEnSoles(previa.totalDespues)}</b>
              </span>
            ) : null}
          </div>

          <MotivoDelAjuste
            atajos={ATAJOS_DE_CORTESIA}
            motivo={motivo}
            error={errorMotivo}
            onCambio={(m) => {
              setMotivo(m);
              setErrorMotivo(undefined);
            }}
          />

          <AcercaDeLaClave conClave={conClave} nota={ajuste.nota} />
          <div className="ajuste__pie">
            <AvisoPendiente pendiente={ajuste.pendiente} />
            {fallo ? (
              <Aviso tipo="error" titulo="No pudimos dar la cortesía">
                {fallo.texto}
              </Aviso>
            ) : null}
            <Boton
              variante="principal"
              bloque
              cargando={enviando}
              textoCargando={ajuste.pendiente ? 'Pendiente de envío' : 'Registrando…'}
              disabled={!ajustable}
              onClick={() => void dar()}
            >
              {conClave ? 'Pedir clave de supervisor' : 'Dar cortesía'}
            </Boton>
          </div>
        </div>
      </Hoja>
      {ajuste.ventana}
    </>
  );
}
