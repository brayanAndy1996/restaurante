import type { MovimientoRespuesta, ReporteCaja, TurnoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoMonto,
  CampoTexto,
  EstadoVacio,
  EtiquetaDeEstado,
  IconoBajar,
  IconoPago,
  IconoSubir,
  Segmentos,
} from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi } from '../../lib/errores';
import { EstadoDeLaImpresion } from './impresion-caja';
import {
  CLAVE_DE_TURNO,
  NOMBRE_DE_MOVIMIENTO,
  horaDelTurno,
  mensajeDeCaja,
  movimientosRecientesPrimero,
  registrarMovimiento,
  soles,
  useIdConservado,
  validarMovimiento,
  type BorradorDeMovimiento,
} from './turno';

const OPCIONES = [
  { valor: 'EGRESO', etiqueta: 'Egreso' },
  { valor: 'INGRESO', etiqueta: 'Ingreso' },
] as const;

interface Props {
  turno: TurnoRespuesta;
  reporte: ReporteCaja | undefined;
  /** El reporte (de donde sale la lista) todavía no llegó o falló: la lista lo dice. */
  cargando: boolean;
  fallo: boolean;
}

/**
 * "Movimientos" del turno (criterios 28 y 110 de 006): un ingreso o un egreso de efectivo con su monto y su motivo, sin
 * clave de supervisor, y debajo lo que ya se registró en este turno. El `id` del movimiento nace al pulsar y se
 * conserva hasta una respuesta final: repetir el envío tras un corte no lo duplica.
 */
export function Movimientos({ turno, reporte, cargando, fallo }: Props) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const idDelMovimiento = useIdConservado();
  const [borrador, setBorrador] = useState<BorradorDeMovimiento>({
    tipo: 'EGRESO',
    monto: '',
    motivo: '',
  });
  const [errores, setErrores] = useState<{ monto?: string; motivo?: string }>({});
  const [problema, setProblema] = useState<string>();
  const [hecho, setHecho] = useState<string>();
  const [gaveta, setGaveta] = useState<Pick<MovimientoRespuesta, 'impresion' | 'trabajoId'>>();
  const [enviando, setEnviando] = useState(false);

  function cambiar(parcial: Partial<BorradorDeMovimiento>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setErrores((e) => {
      const siguiente = { ...e };
      if (parcial.monto !== undefined) delete siguiente.monto;
      if (parcial.motivo !== undefined) delete siguiente.motivo;
      return siguiente;
    });
    setProblema(undefined);
    setHecho(undefined);
    setGaveta(undefined);
  }

  async function registrar() {
    if (enviando) return;
    const resultado = validarMovimiento(borrador);
    if (!resultado.ok) {
      setErrores(resultado.errores);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrores({});
    setProblema(undefined);
    setHecho(undefined);
    setGaveta(undefined);
    setEnviando(true);
    const id = idDelMovimiento.para(`${resultado.tipo}|${resultado.monto}|${resultado.motivo}`);
    try {
      const movimiento = await envio.enviar((extra) =>
        registrarMovimiento(
          turno.id,
          { id, tipo: resultado.tipo, monto: resultado.monto, motivo: resultado.motivo },
          extra,
        ),
      );
      idDelMovimiento.soltar();
      setGaveta({ impresion: movimiento.impresion, trabajoId: movimiento.trabajoId });
      setHecho(
        `${NOMBRE_DE_MOVIMIENTO[resultado.tipo]} de ${soles(resultado.monto)} registrado: ${resultado.motivo}`,
      );
      setBorrador((b) => ({ ...b, monto: '', motivo: '' }));
      void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
    } catch (error) {
      if (!(error instanceof ErrorApi && error.sinConexion)) idDelMovimiento.soltar();
      if (error instanceof ErrorApi && ['TURNO_CERRADO', 'TURNO_AJENO'].includes(error.codigo)) {
        void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
      }
      setProblema(mensajeDeCaja(error));
    } finally {
      setEnviando(false);
    }
  }

  const lista = reporte ? movimientosRecientesPrimero(reporte.movimientos.lista) : [];
  const etiquetaDelBoton = borrador.tipo === 'EGRESO' ? 'Registrar egreso' : 'Registrar ingreso';

  return (
    <div className="turno__movimientos">
      <form
        className="turno__formulario"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void registrar();
        }}
      >
        <h3 className="formulario__titulo turno__titulo-form">Registrar un movimiento</h3>
        <div className="turno__tipo">
          <Segmentos
            etiqueta="Tipo de movimiento"
            opciones={OPCIONES}
            valor={borrador.tipo}
            onCambio={(tipo) => cambiar({ tipo })}
          />
        </div>
        <p className="texto-ayuda">
          {borrador.tipo === 'EGRESO'
            ? 'Sale efectivo de la caja: un pago a un proveedor, hielo, propinas.'
            : 'Entra efectivo a la caja: sencillo, un aporte. Siempre es en efectivo.'}
        </p>
        <CampoMonto
          etiqueta="Monto"
          value={borrador.monto}
          onValor={(monto) => cambiar({ monto })}
          error={errores.monto}
          disabled={enviando}
        />
        <CampoTexto
          etiqueta="Motivo"
          value={borrador.motivo}
          onChange={(e) => cambiar({ motivo: e.target.value })}
          error={errores.motivo}
          maxLength={300}
          autoComplete="off"
          enterKeyHint="done"
          disabled={enviando}
        />
        <AvisoPendiente pendiente={envio.pendiente} />
        {problema ? (
          <Aviso tipo="error" titulo="No pudimos registrar el movimiento">
            {problema}
          </Aviso>
        ) : null}
        {hecho ? (
          <>
            <div role="status">
              <Aviso tipo="ok" titulo="Registrado">
                {hecho}
              </Aviso>
            </div>
            <EstadoDeLaImpresion
              gaveta
              impresion={gaveta?.impresion}
              trabajoId={gaveta?.trabajoId}
            />
          </>
        ) : null}
        <Boton
          type="submit"
          variante="principal"
          bloque
          cargando={enviando}
          textoCargando="Registrando…"
        >
          {etiquetaDelBoton}
        </Boton>
      </form>

      <section className="turno__historial" aria-labelledby="movimientos-titulo">
        <h3 className="formulario__titulo" id="movimientos-titulo">
          Movimientos de este turno
        </h3>
        {cargando ? (
          <p className="texto-ayuda" role="status">
            Cargando los movimientos…
          </p>
        ) : fallo ? (
          <Aviso tipo="alerta" titulo="No pudimos cargar los movimientos">
            Lo que registres igual se guarda. Vuelve a abrir esta pantalla para verlos.
          </Aviso>
        ) : lista.length === 0 ? (
          <EstadoVacio icono={IconoPago} titulo="Aún no hay movimientos">
            Los ingresos y egresos de efectivo que registres aparecerán aquí.
          </EstadoVacio>
        ) : (
          <ul className="turno__lista">
            {lista.map((m) => (
              <li key={m.id} className="turno__movimiento">
                <span className="turno__movimiento-texto">
                  <EtiquetaDeEstado
                    tono={m.tipo === 'INGRESO' ? 'ok' : 'neutro'}
                    icono={m.tipo === 'INGRESO' ? IconoSubir : IconoBajar}
                  >
                    {NOMBRE_DE_MOVIMIENTO[m.tipo]}
                  </EtiquetaDeEstado>
                  <span className="turno__movimiento-motivo">{m.motivo}</span>
                  <span className="texto-ayuda">
                    {`${horaDelTurno(m.creadoEn)}${m.creadoPor ? ` · ${m.creadoPor.nombre}` : ''}`}
                  </span>
                </span>
                <b className="turno__movimiento-monto">
                  {m.tipo === 'INGRESO' ? '+' : '-'}
                  {soles(m.monto)}
                </b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
