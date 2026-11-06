import type { CajaRespuesta, TurnoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoMonto,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoPago,
  OpcionesConAyuda,
  claseBoton,
  type OpcionConAyuda,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, erroresPorCampo } from '../../lib/errores';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import {
  claveEmisores,
  claveSucursal,
  claveTasas,
  leerEmisorDeLaSucursal,
  listarEmisores,
  listarTasas,
  pasosDeInicio,
  tasaVigente,
  textoDeTurno,
  type EstadoDeTasa,
  type PasoDeInicio,
} from '../administracion/caja/cajas';
import { PrimerosPasos } from '../administracion/caja/PrimerosPasos';
import { EnlaceAComprobantes } from '../facturacion/EnlaceAComprobantes';
import '../administracion/caja/caja.css';
import {
  CLAVE_DE_TURNO,
  abrirTurno,
  cajaConSeries,
  cajaInicial,
  cajaLibre,
  claveCajasDeTurno,
  claveTurnoMio,
  guardarPreferenciaDeCaja,
  listarCajasActivas,
  mensajeDeCaja,
  preferenciaDeCaja,
  soles,
  useIdConservado,
  validarApertura,
} from './turno';

interface Props {
  empresaId: string;
  usuarioId: string;
  sucursalId: string;
  esAdministrador: boolean;
  /** La sesión ya sabe que la sucursal está suspendida (solo el Administrador recibe ese aviso). */
  suspendida: boolean;
  /** El turno quedó abierto: la pantalla guarda lo que dijo la API de la gaveta (criterio 93). */
  onAbierta?: (turno: TurnoRespuesta) => void;
}

/** Lo que falta para cobrar, con una acción para el Administrador y la frase de a quién pedírselo para los demás. */
function GuiaDeInicio({
  pasos,
  esAdministrador,
}: {
  pasos: readonly PasoDeInicio[];
  esAdministrador: boolean;
}) {
  if (pasos.every((p) => p.hecho)) return null;
  return (
    <div className="turno__guia">
      <PrimerosPasos
        pasos={pasos}
        {...(esAdministrador
          ? {
              accion: (paso: PasoDeInicio) => (
                <Link
                  to={paso.id === 'tasa' ? '/administracion/emisores' : '/administracion/cajas'}
                  className={claseBoton()}
                >
                  {paso.id === 'caja'
                    ? 'Crear una caja'
                    : paso.id === 'series'
                      ? 'Poner series a una caja'
                      : 'Poner la tasa de IGV'}
                </Link>
              ),
            }
          : {})}
      />
      {esAdministrador ? null : (
        <p className="texto-ayuda">
          Pídele a tu administrador que lo configure en Ajustes › Cajas.
        </p>
      )}
    </div>
  );
}

/** El paso de la tasa solo lo puede leer el Administrador (la tasa es del emisor): para los demás no se sabe. */
function useEstadoDeTasa(sucursalId: string, activo: boolean): EstadoDeTasa | undefined {
  const sucursal = useQuery({
    queryKey: claveSucursal(sucursalId),
    queryFn: ({ signal }) => leerEmisorDeLaSucursal(sucursalId, signal),
    enabled: activo,
  });
  const emisorId = sucursal.data?.emisorId;
  const emisores = useQuery({
    queryKey: claveEmisores,
    queryFn: ({ signal }) => listarEmisores(signal),
    enabled: activo && emisorId !== undefined,
  });
  const tasas = useQuery({
    queryKey: claveTasas(emisorId ?? ''),
    queryFn: ({ signal }) => listarTasas(emisorId ?? '', signal),
    enabled: activo && emisorId !== undefined,
  });
  const regimen = emisores.data?.find((e) => e.id === emisorId)?.regimen;
  if (!activo || regimen === undefined || tasas.data === undefined) return undefined;
  return { necesaria: regimen !== 'NUEVO_RUS', configurada: tasaVigente(tasas.data) !== undefined };
}

function opcionDeCaja(caja: CajaRespuesta): OpcionConAyuda<string> {
  const libre = cajaLibre(caja);
  const sinSeries = cajaConSeries(caja) ? '' : ' · Sin series: no emite comprobantes';
  return {
    valor: caja.id,
    titulo: caja.nombre,
    ayuda: libre ? `${textoDeTurno(caja)}${sinSeries}` : `${textoDeTurno(caja)}. No se puede abrir`,
    deshabilitada: !libre,
  };
}

/**
 * `/caja` sin turno (criterio 109 de 006): las cajas de la sucursal con su estado ("Libre" o "Abierta por Ana desde las
 * 18:02"), el fondo con que se abre y "Abrir caja". La caja elegida y el último fondo se recuerdan en el equipo; el
 * fondo nunca se escribe solo. Si falta configurar cajas, series o la tasa de IGV, la guía de primeros pasos lo dice.
 */
export function AbrirCaja({
  empresaId,
  usuarioId,
  sucursalId,
  esAdministrador,
  suspendida,
  onAbierta,
}: Props) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const consulta = useQuery({
    queryKey: claveCajasDeTurno(sucursalId),
    queryFn: ({ signal }) => listarCajasActivas(signal),
    refetchInterval: sondeo,
  });
  const estadoDeTasa = useEstadoDeTasa(sucursalId, esAdministrador);
  const cajas = consulta.data;

  const recordada = preferenciaDeCaja(empresaId, usuarioId, sucursalId);
  const [elegidaPorLaPersona, setElegida] = useState('');
  const [fondo, setFondo] = useState('');
  const [errores, setErrores] = useState<{ cajaId?: string; fondo?: string }>({});
  const [fallo, setFallo] = useState<{ titulo: string; mensaje: string }>();
  const [abriendo, setAbriendo] = useState(false);
  const envio = useEnvioPendiente();
  const idDelTurno = useIdConservado();

  // La caja de la persona vale mientras siga libre; si otra persona la abrió, se vuelve a la recordada o a la única libre.
  const elegida =
    cajas?.some((c) => c.id === elegidaPorLaPersona && cajaLibre(c)) === true
      ? elegidaPorLaPersona
      : cajaInicial(cajas ?? [], recordada.cajaId);

  async function abrir() {
    if (abriendo) return;
    const resultado = validarApertura({ cajaId: elegida, fondo });
    if (!resultado.ok) {
      setErrores(resultado.errores);
      setFallo(undefined);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrores({});
    setFallo(undefined);
    setAbriendo(true);
    // El `id` del turno nace al pulsar y se conserva hasta una respuesta final (criterio 24).
    const id = idDelTurno.para(`${resultado.cajaId}|${resultado.fondo}`);
    try {
      const turno: TurnoRespuesta = await envio.enviar((extra) =>
        abrirTurno({ id, cajaId: resultado.cajaId, fondo: resultado.fondo }, extra),
      );
      idDelTurno.soltar();
      guardarPreferenciaDeCaja(empresaId, usuarioId, sucursalId, {
        cajaId: resultado.cajaId,
        fondo: resultado.fondo,
      });
      onAbierta?.(turno);
      // Con el turno guardado la pantalla pasa sola a "Mi turno".
      clientes.setQueryData(claveTurnoMio(usuarioId, sucursalId), turno);
      void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
    } catch (error) {
      // Sin respuesta (red caída) el `id` se conserva: pulsar otra vez no duplica.
      if (!(error instanceof ErrorApi && error.sinConexion)) idDelTurno.soltar();
      if (error instanceof ErrorApi && error.codigo === 'DATOS_INVALIDOS') {
        const delFondo = erroresPorCampo(error).fondo;
        if (delFondo) setErrores({ fondo: 'Escribe un monto válido, por ejemplo 200.00' });
      }
      if (
        error instanceof ErrorApi &&
        ['TURNO_YA_ABIERTO', 'CONFLICTO', 'NO_ENCONTRADO'].includes(error.codigo)
      ) {
        // La lista de cajas y mi turno cambiaron: se vuelven a pedir.
        void clientes.invalidateQueries({ queryKey: CLAVE_DE_TURNO });
      }
      setFallo({
        titulo:
          error instanceof ErrorApi && error.codigo === 'SUCURSAL_SUSPENDIDA'
            ? 'La sucursal está suspendida'
            : 'No pudimos abrir la caja',
        mensaje: mensajeDeCaja(error),
      });
    } finally {
      setAbriendo(false);
    }
  }

  const hayCajas = (cajas ?? []).length > 0;
  const bloqueada = suspendida;

  // La acción fija de abajo, al alcance del pulgar.
  const pie =
    consulta.isSuccess && hayCajas ? (
      <Boton
        variante="principal"
        bloque
        cargando={abriendo}
        textoCargando="Abriendo…"
        disabled={bloqueada}
        onClick={() => void abrir()}
      >
        Abrir caja
      </Boton>
    ) : undefined;

  let cuerpo: ReactNode;
  if (consulta.isPending) {
    cuerpo = <EsqueletoDeLista etiqueta="Cargando las cajas" conInicial filas={3} />;
  } else if (consulta.isError) {
    cuerpo = (
      <ErrorDeCarga
        titulo="No pudimos cargar las cajas"
        onReintentar={() => void consulta.refetch()}
        reintentando={consulta.isFetching}
      >
        {mensajeDeCaja(consulta.error)}
      </ErrorDeCarga>
    );
  } else {
    const pasos = pasosDeInicio(cajas ?? [], estadoDeTasa);
    cuerpo = (
      <div className="turno__abrir">
        {bloqueada ? (
          <Aviso tipo="error" titulo="La sucursal está suspendida">
            No se puede abrir caja. Puedes consultar y exportar tus datos. Se reactiva al
            registrarse el pago.
          </Aviso>
        ) : null}
        <AvisoPendiente pendiente={envio.pendiente} />
        {fallo ? (
          <Aviso tipo="error" titulo={fallo.titulo}>
            {fallo.mensaje}
          </Aviso>
        ) : null}
        <GuiaDeInicio pasos={pasos} esAdministrador={esAdministrador} />
        {hayCajas ? (
          <>
            <OpcionesConAyuda
              etiqueta="Caja que vas a abrir"
              opciones={(cajas ?? []).map(opcionDeCaja)}
              valor={elegida}
              onCambio={(valor) => {
                setElegida(valor);
                setErrores((e) => ({ ...e, cajaId: undefined }));
              }}
              error={errores.cajaId}
            />
            <div className="turno__fondo">
              <CampoMonto
                etiqueta="Fondo inicial"
                ayuda="El efectivo con que empiezas el turno. Si empiezas sin dinero, escribe 0.00."
                value={fondo}
                onValor={(valor) => {
                  setFondo(valor);
                  setErrores((e) => ({ ...e, fondo: undefined }));
                }}
                error={errores.fondo}
                disabled={abriendo}
              />
              {recordada.fondo !== null && fondo !== recordada.fondo ? (
                <Boton variante="texto" onClick={() => setFondo(recordada.fondo ?? '')}>
                  {`Usar ${soles(recordada.fondo)}, como la última vez`}
                </Boton>
              ) : null}
            </div>
          </>
        ) : (
          <EstadoVacio icono={IconoPago} titulo="Aún no hay cajas">
            {esAdministrador
              ? 'Crea la primera en Ajustes › Cajas y vuelve aquí para abrirla.'
              : 'Tu administrador debe crear una caja antes de poder abrir turno.'}
          </EstadoVacio>
        )}
        <EnlaceAComprobantes />
      </div>
    );
  }

  return (
    <Pagina titulo="Caja" {...(pie ? { pie } : {})}>
      {cuerpo}
    </Pagina>
  );
}
