import type { DiferenciaDeArqueo, ReporteCaja, TurnoRespuesta } from '@restaurante/contratos';
import { MEDIOS_PAGO, type MedioPago } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoMonto,
  CampoTexto,
  ContenidoDeFila,
  DialogoConfirmacion,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoOk,
  ListaDeFilas,
  Segmentos,
  claseFila,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi } from '../../lib/errores';
import { montoEsCero } from '../../lib/monto';
import { rutaDeOrden } from '../salon/salon';
import {
  ATAJOS_DE_MOTIVO,
  AYUDA_DE_CONTEO,
  CLAVE_DE_TURNO,
  CONTEO_VACIO,
  NOMBRE_DE_MEDIO,
  cerrarTurno,
  cuentasAbiertasDelSalon,
  cuerpoDeCierre,
  leerSalonParaCierre,
  medioDeCampoDeConteo,
  mediosConDiferencia,
  mensajeDeCaja,
  motivosQueFaltan,
  soles,
  textoDeCuentasAbiertas,
  textoDeDiferencia,
  validarConteo,
  type ConteoEscrito,
  type MotivosEscritos,
} from './turno';

interface Props {
  turno: TurnoRespuesta;
  /** El turno quedó cerrado: la pantalla pasa a mostrar la Z. */
  onCerrada: (reporte: ReporteCaja) => void;
}

type Errores = Partial<Record<MedioPago, string>>;

/** Las cuentas que impiden cerrar, con un enlace a cada una (criterio 116). */
function CuentasAbiertas({ ordenes }: { ordenes: number }) {
  const salon = useQuery({
    queryKey: ['turno', 'cierre-bloqueado', 'salon'],
    queryFn: ({ signal }) => leerSalonParaCierre(signal),
    // Es un dato que la persona necesita fresco y no se reutiliza.
    gcTime: 0,
    retry: false,
  });
  const cuentas = salon.data ? cuentasAbiertasDelSalon(salon.data) : [];
  const restantes = Math.max(0, ordenes - cuentas.length);
  return (
    <section className="turno__bloqueo" aria-labelledby="cuentas-abiertas-titulo">
      <Aviso tipo="error" titulo={textoDeCuentasAbiertas(ordenes)}>
        <span id="cuentas-abiertas-titulo">
          Cóbralas o anúlalas y vuelve a cerrar. Lo que contaste sigue aquí.
        </span>
      </Aviso>
      {cuentas.length > 0 ? (
        <ListaDeFilas etiqueta="Cuentas abiertas">
          {cuentas.map((c) => (
            <li key={c.ordenId}>
              <Link to={rutaDeOrden(c.ordenId)} className={claseFila()}>
                <ContenidoDeFila
                  titulo={c.texto}
                  ayuda={c.detalle}
                  derecha={<Icono icono={IconoDerecha} />}
                />
              </Link>
            </li>
          ))}
        </ListaDeFilas>
      ) : salon.isPending ? (
        <p className="texto-ayuda" role="status">
          Buscando las cuentas…
        </p>
      ) : null}
      {restantes > 0 && cuentas.length > 0 ? (
        <p className="texto-ayuda">
          {restantes === 1
            ? 'Y 1 cuenta más que no está en una mesa.'
            : `Y ${restantes} cuentas más que no están en una mesa.`}
        </p>
      ) : null}
    </section>
  );
}

/**
 * "Cerrar caja" (criterios 31 a 35 y 116 de 006). Primero la persona cuenta cada medio sin ver lo que debería haber
 * (arqueo a ciegas, pregunta 3): el esperado nunca se pide ni se muestra aquí. Si algún medio no cuadra, la API
 * responde con las diferencias, sin el esperado, y entonces se pide el motivo de cada una. "Cerrar con Z" siempre
 * pide confirmación. Con cuentas abiertas se dice cuáles y se conserva lo contado.
 *
 * La clave de idempotencia del cierre se conserva mientras el cuerpo sea el mismo y cambia si cambió: así repetir
 * el envío no repite el efecto, y corregir un dato no choca con el envío anterior.
 */
export function CerrarCaja({ turno, onCerrada }: Props) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const [escrito, setEscrito] = useState<ConteoEscrito>(CONTEO_VACIO);
  const [motivos, setMotivos] = useState<MotivosEscritos>(CONTEO_VACIO);
  const [diferencias, setDiferencias] = useState<DiferenciaDeArqueo[] | null>(null);
  const [erroresDeConteo, setErroresDeConteo] = useState<Errores>({});
  const [erroresDeMotivo, setErroresDeMotivo] = useState<Errores>({});
  const [bloqueo, setBloqueo] = useState<{ ordenes: number } | null>(null);
  const [fallo, setFallo] = useState<string>();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const claveDelCierre = useRef<{ cuerpo: string; clave: string } | null>(null);

  const paso = diferencias ? 'motivos' : 'contar';
  // Al pasar a los motivos o al aparecer el bloqueo, lo nuevo está arriba: la vista vuelve allí.
  const haySalida = bloqueo !== null || fallo !== undefined;
  useEffect(() => {
    const marco = document.getElementById('contenido');
    if (marco) marco.scrollTop = 0;
  }, [paso, haySalida]);
  const conteo = validarConteo(escrito);

  function ponerConteo(medio: MedioPago, valor: string) {
    setEscrito((c) => ({ ...c, [medio]: valor }));
    setErroresDeConteo((e) => ({ ...e, [medio]: undefined }));
    setBloqueo(null);
    setFallo(undefined);
  }

  function ponerMotivo(medio: MedioPago, valor: string) {
    setMotivos((m) => ({ ...m, [medio]: valor }));
    setErroresDeMotivo((e) => ({ ...e, [medio]: undefined }));
    setFallo(undefined);
  }

  /** Volver a contar: lo que se contó puede cambiar, y con él las diferencias y sus motivos. */
  function volverAContar() {
    setDiferencias(null);
    setMotivos(CONTEO_VACIO);
    setErroresDeMotivo({});
    setBloqueo(null);
    setFallo(undefined);
  }

  function pedirConfirmacion() {
    if (enviando) return;
    setFallo(undefined);
    if (paso === 'contar') {
      if (!conteo.ok) {
        setErroresDeConteo(conteo.errores);
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus(),
        );
        return;
      }
    } else if (diferencias) {
      const faltan = motivosQueFaltan(diferencias, motivos);
      if (Object.keys(faltan).length > 0) {
        setErroresDeMotivo(faltan);
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus(),
        );
        return;
      }
    }
    setConfirmando(true);
  }

  async function cerrar() {
    if (!conteo.ok || enviando) return;
    const conMotivo = new Set(diferencias ? mediosConDiferencia(diferencias) : []);
    const cuerpo = cuerpoDeCierre(conteo.contado, motivos, conMotivo);
    const texto = JSON.stringify(cuerpo);
    // Mismo cuerpo, misma clave; otro cuerpo, clave nueva.
    if (claveDelCierre.current?.cuerpo !== texto) {
      claveDelCierre.current = { cuerpo: texto, clave: nuevaClaveDeIdempotencia() };
    }
    const clave = claveDelCierre.current.clave;
    setEnviando(true);
    setBloqueo(null);
    try {
      const reporte = await envio.enviar(
        (extra) => cerrarTurno(turno.id, cuerpo, extra),
        undefined,
        undefined,
        clave,
      );
      claveDelCierre.current = null;
      setConfirmando(false);
      void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
      onCerrada(reporte);
    } catch (error) {
      setConfirmando(false);
      if (error instanceof ErrorApi && error.codigo === 'DIFERENCIA_SIN_MOTIVO') {
        if (error.diferencias && error.diferencias.length > 0) {
          setDiferencias(error.diferencias);
        }
        // Si ya se habían escrito motivos y falta alguno, el servidor dice cuáles.
        const faltantes: Errores = {};
        for (const campo of error.campos) {
          const medio = medioDeCampoDeConteo(campo.campo);
          if (medio) faltantes[medio] = 'Escribe el motivo de esta diferencia';
        }
        setErroresDeMotivo(diferencias ? faltantes : {});
        return;
      }
      if (error instanceof ErrorApi && error.codigo === 'CIERRE_BLOQUEADO') {
        setBloqueo({ ordenes: error.ordenes ?? 0 });
        return;
      }
      if (error instanceof ErrorApi && ['TURNO_CERRADO', 'TURNO_AJENO'].includes(error.codigo)) {
        void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
      }
      setFallo(mensajeDeCaja(error));
    } finally {
      setEnviando(false);
    }
  }

  const pie = (
    <Boton
      variante="principal"
      bloque
      cargando={enviando}
      textoCargando="Cerrando…"
      onClick={pedirConfirmacion}
    >
      Cerrar con Z
    </Boton>
  );

  return (
    <Pagina titulo="Cerrar caja" atras={{ a: '/caja', etiqueta: 'Caja' }} pie={pie}>
      <div className="turno__cierre">
        <AvisoPendiente pendiente={envio.pendiente} />
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos cerrar la caja">
            {fallo}
          </Aviso>
        ) : null}
        {bloqueo ? <CuentasAbiertas ordenes={bloqueo.ordenes} /> : null}

        {paso === 'contar' ? (
          <section className="turno__conteo" aria-labelledby="conteo-titulo">
            <h2 className="formulario__titulo" id="conteo-titulo">
              Cuenta lo que hay en cada medio
            </h2>
            <p className="texto-ayuda">
              Escribe lo que contaste. No mostramos lo que debería haber hasta que termines de
              contar. Si en un medio no hay nada, escribe 0.00.
            </p>
            {MEDIOS_PAGO.map((medio) => (
              <CampoMonto
                key={medio}
                etiqueta={NOMBRE_DE_MEDIO[medio]}
                ayuda={AYUDA_DE_CONTEO[medio]}
                value={escrito[medio]}
                onValor={(valor) => ponerConteo(medio, valor)}
                error={erroresDeConteo[medio]}
                disabled={enviando}
              />
            ))}
          </section>
        ) : (
          <section className="turno__conteo" aria-labelledby="diferencias-titulo">
            <h2 className="formulario__titulo" id="diferencias-titulo">
              Escribe el motivo de cada diferencia
            </h2>
            <p className="texto-ayuda">
              Hay medios que no cuadran con lo que registró el sistema. Di qué pasó para que quede
              en el cierre.
            </p>
            <ul className="turno__diferencias">
              {(diferencias ?? []).map((d) => {
                const cuadra = montoEsCero(d.diferencia);
                return (
                  <li key={d.medio} className="turno__diferencia">
                    <div className="turno__diferencia-cabecera">
                      <span className="turno__diferencia-texto">
                        <b>{NOMBRE_DE_MEDIO[d.medio]}</b>
                        <span className="texto-ayuda">{`Contaste ${soles(d.contado)}`}</span>
                      </span>
                      {cuadra ? (
                        <EtiquetaDeEstado tono="ok" icono={IconoOk}>
                          Cuadra
                        </EtiquetaDeEstado>
                      ) : (
                        <EtiquetaDeEstado tono="alerta">
                          {textoDeDiferencia(d.diferencia)}
                        </EtiquetaDeEstado>
                      )}
                    </div>
                    {cuadra ? null : (
                      <div className="turno__motivo">
                        <Segmentos
                          etiqueta={`Motivos frecuentes: ${NOMBRE_DE_MEDIO[d.medio]}`}
                          opciones={ATAJOS_DE_MOTIVO.map((a) => ({ valor: a, etiqueta: a }))}
                          valor={motivos[d.medio]}
                          onCambio={(valor) => ponerMotivo(d.medio, valor)}
                        />
                        <CampoTexto
                          etiqueta={`Motivo de la diferencia en ${NOMBRE_DE_MEDIO[d.medio].toLowerCase()}`}
                          value={motivos[d.medio]}
                          onChange={(e) => ponerMotivo(d.medio, e.target.value)}
                          error={erroresDeMotivo[d.medio]}
                          maxLength={300}
                          autoComplete="off"
                          disabled={enviando}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Boton onClick={volverAContar} disabled={enviando}>
              Volver a contar
            </Boton>
          </section>
        )}
      </div>

      <DialogoConfirmacion
        abierta={confirmando}
        titulo="¿Cerrar la caja con Z?"
        etiquetaConfirmar="Cerrar con Z"
        cargando={enviando}
        textoCargando="Cerrando…"
        onConfirmar={() => void cerrar()}
        onCancelar={() => setConfirmando(false)}
      >
        {paso === 'contar'
          ? 'Se cierra tu turno y ya no podrás cobrar ni registrar movimientos en él. Si algún medio no cuadra, antes te pediremos el motivo.'
          : 'Se cierra tu turno con estas diferencias y sus motivos. Ya no podrás cobrar ni registrar movimientos en él.'}
      </DialogoConfirmacion>
    </Pagina>
  );
}
