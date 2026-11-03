import type { LlamadoResumen } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoCuenta,
  IconoDerecha,
  IconoLlamarMozo,
  IconoPedido,
  Interruptor,
  nombreAccesibleDeMesa,
  type LucideIcon,
} from '@restaurante/ui';
import { Link } from 'react-router-dom';
import { useSonidoDeLlamados } from '../../lib/avisos-de-llamados';
import { horaDeLima } from '../../lib/formato';
import { useSesionActiva } from '../acceso/sesion';
import { motorDeSonido } from '../cocina/sonido';
import { rutaDeLlamado } from '../salon/salon';
import { useAtencion } from './AtencionDeLlamado';
import {
  TEXTO_DE_ESTADO_CERRADO,
  TEXTO_DE_TIPO,
  clasificarLlamados,
  esParaMi,
  estaPorVencer,
  estadoDeLlamado,
  textoDeAntiguedad,
  textoDePlatos,
  textoDeVencimiento,
} from './llamados';
import { useAhoraDeLlamados, useLlamados } from './useLlamados';
import './llamados.css';

const ICONO_DE_TIPO: Record<LlamadoResumen['tipo'], LucideIcon> = {
  PEDIDO: IconoPedido,
  LLAMAR_MOZO: IconoLlamarMozo,
  PEDIR_CUENTA: IconoCuenta,
};

/**
 * El segmento «Llamados» del salón (005, criterio 70): los pendientes con "vence en", "Para ti" y el botón
 * «Atender»; los pedidos ya atendidos que falta pasar a la cuenta; y «Recientes». Se refresca con
 * `llamado.nuevo` y `llamado.cambio` y, sin socket, cada 30 s con `ETag`. Un llamado vencido sale de pendientes
 * cuando llega su hora, medida con el `ahora` del servidor.
 */
export function ListaDeLlamados({ sucursalId }: { sucursalId: string }) {
  const sesion = useSesionActiva();
  const usuarioId = sesion.usuario?.id ?? null;
  const consulta = useLlamados(sucursalId);
  const datos = consulta.data;
  const ahora = useAhoraDeLlamados(datos);
  const atencion = useAtencion();
  const [sonidoActivo, cambiarSonido] = useSonidoDeLlamados();

  const { pendientes, enAtencion, recientes } = clasificarLlamados(
    datos?.respuesta.llamados ?? [],
    ahora,
  );

  return (
    <div className="llamados">
      <div className="llamados__sonido">
        <Interruptor
          etiqueta="Sonido de avisos"
          marcado={sonidoActivo}
          onCambio={(activo) => {
            // Tocar el interruptor ya es un gesto: despierta el audio.
            if (activo) motorDeSonido().desbloquear();
            cambiarSonido(activo);
          }}
          ayuda={
            sonidoActivo && !motorDeSonido().listo()
              ? 'Toca la pantalla una vez para activar el sonido.'
              : sonidoActivo
                ? 'Suena y vibra cuando llega un llamado para ti.'
                : 'Silenciado en este equipo. Seguirás viendo los avisos.'
          }
        />
      </div>

      {atencion.aviso}
      {atencion.falloSinHoja ? (
        <Aviso tipo="error" titulo="No pudimos atenderlo">
          {atencion.falloSinHoja}
        </Aviso>
      ) : null}

      {datos === undefined && consulta.isPending ? (
        <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando los llamados" />
      ) : null}
      {datos === undefined && consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los llamados"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          Revisa tu conexión e inténtalo de nuevo.
        </ErrorDeCarga>
      ) : null}
      {datos !== undefined && consulta.isError ? (
        <Aviso tipo="alerta" titulo="No pudimos actualizar los llamados">
          Lo que ves puede estar desactualizado. Seguimos intentando.
        </Aviso>
      ) : null}

      {datos !== undefined ? (
        <>
          <section className="llamados__seccion" aria-labelledby="llamados-pendientes">
            <h2 className="llamados__titulo" id="llamados-pendientes">
              Pendientes
            </h2>
            {pendientes.length === 0 ? (
              <EstadoVacio icono={IconoLlamarMozo} titulo="No hay llamados pendientes">
                Cuando un cliente pida desde el QR de su mesa, aparecerá aquí.
              </EstadoVacio>
            ) : (
              <ul className="llamados__lista" aria-label="Llamados pendientes">
                {pendientes.map((l) => (
                  <li key={l.id}>
                    <FilaPendiente
                      llamado={l}
                      ahora={ahora}
                      paraMi={esParaMi(l.destinatarios, usuarioId)}
                      atendiendo={atencion.atendiendoId === l.id}
                      bloqueada={atencion.atendiendoId !== null}
                      onAtender={() => atencion.atender(l)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {enAtencion.length > 0 ? (
            <section className="llamados__seccion" aria-labelledby="llamados-en-atencion">
              <h2 className="llamados__titulo" id="llamados-en-atencion">
                En atención
              </h2>
              <ul className="llamados__lista" aria-label="Pedidos en atención">
                {enAtencion.map((l) => (
                  <li key={l.id}>
                    <FilaEnAtencion llamado={l} ahora={ahora} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {recientes.length > 0 ? (
            <section className="llamados__seccion" aria-labelledby="llamados-recientes">
              <h2 className="llamados__titulo" id="llamados-recientes">
                Recientes
              </h2>
              <ul className="llamados__lista" aria-label="Llamados recientes">
                {recientes.map((l) => (
                  <li key={l.id}>
                    <FilaReciente llamado={l} ahora={ahora} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {atencion.hoja}
    </div>
  );
}

/** "Mesa 4": el título de cada fila. El tipo va aparte, en una etiqueta con icono y texto. */
function Titulo({ llamado }: { llamado: LlamadoResumen }) {
  return <span className="llamado__titulo">{nombreAccesibleDeMesa(llamado.mesa.nombre)}</span>;
}

/** "Pedido · 4 platos", "Llama al mozo", "Pide la cuenta": lo que pidió el cliente, con su icono. */
function EtiquetaDeTipo({ llamado }: { llamado: LlamadoResumen }) {
  return (
    <EtiquetaDeEstado tono="alerta" icono={ICONO_DE_TIPO[llamado.tipo]}>
      {TEXTO_DE_TIPO[llamado.tipo]}
      {llamado.tipo === 'PEDIDO' && llamado.unidades > 0
        ? ` · ${textoDePlatos(llamado.unidades)}`
        : ''}
    </EtiquetaDeEstado>
  );
}

function FilaPendiente({
  llamado,
  ahora,
  paraMi,
  atendiendo,
  bloqueada,
  onAtender,
}: {
  llamado: LlamadoResumen;
  ahora: number;
  paraMi: boolean;
  atendiendo: boolean;
  bloqueada: boolean;
  onAtender: () => void;
}) {
  const vence = textoDeVencimiento(llamado.venceEn, ahora);
  const pronto = estaPorVencer(llamado.venceEn, ahora);
  const mesa = nombreAccesibleDeMesa(llamado.mesa.nombre);
  return (
    <div className="llamado">
      <Link
        to={rutaDeLlamado(llamado.id)}
        className="llamado__cuerpo"
        aria-label={`Ver el llamado de la ${mesa.toLowerCase()}: ${TEXTO_DE_TIPO[llamado.tipo]}`}
      >
        <Titulo llamado={llamado} />
        <span className="llamado__etiquetas">
          <EtiquetaDeTipo llamado={llamado} />
          {paraMi ? <EtiquetaDeEstado tono="info">Para ti</EtiquetaDeEstado> : null}
        </span>
        <span className="llamado__ayuda">
          {textoDeAntiguedad(llamado.creadoEn, ahora)} ·{' '}
          <span className={pronto ? 'llamado__vence llamado__vence--pronto' : 'llamado__vence'}>
            {vence}
          </span>
        </span>
      </Link>
      <Boton
        className="llamado__boton"
        cargando={atendiendo}
        textoCargando="Atendiendo…"
        disabled={bloqueada && !atendiendo}
        aria-label={`Atender la ${mesa.toLowerCase()}`}
        onClick={onAtender}
      >
        Atender
      </Boton>
    </div>
  );
}

function FilaEnAtencion({ llamado, ahora }: { llamado: LlamadoResumen; ahora: number }) {
  const mesa = nombreAccesibleDeMesa(llamado.mesa.nombre);
  return (
    <Link
      to={rutaDeLlamado(llamado.id)}
      className="llamado llamado--enlace"
      aria-label={`Revisar el pedido de la ${mesa.toLowerCase()}`}
    >
      <span className="llamado__cuerpo">
        <Titulo llamado={llamado} />
        <span className="llamado__etiquetas">
          <EtiquetaDeTipo llamado={llamado} />
          <EtiquetaDeEstado tono="alerta">Falta pasarlo a la cuenta</EtiquetaDeEstado>
        </span>
        <span className="llamado__ayuda">
          {llamado.atendidoPor ? `Atiende ${llamado.atendidoPor.nombre}` : 'En atención'} ·{' '}
          {textoDeAntiguedad(llamado.atendidoEn ?? llamado.creadoEn, ahora)}
        </span>
      </span>
      <Icono icono={IconoDerecha} />
    </Link>
  );
}

function FilaReciente({ llamado, ahora }: { llamado: LlamadoResumen; ahora: number }) {
  const estado = estadoDeLlamado(llamado, ahora);
  const quien = estado === 'VENCIDO' ? null : (llamado.cerradoPor ?? llamado.atendidoPor)?.nombre;
  const cuando = estado === 'VENCIDO' ? llamado.venceEn : (llamado.cerradoEn ?? llamado.atendidoEn);
  return (
    <Link
      to={rutaDeLlamado(llamado.id)}
      className="llamado llamado--enlace"
      aria-label={`${nombreAccesibleDeMesa(llamado.mesa.nombre)}, ${TEXTO_DE_TIPO[llamado.tipo]}, ${TEXTO_DE_ESTADO_CERRADO[estado] ?? estado}`}
    >
      <span className="llamado__cuerpo">
        <Titulo llamado={llamado} />
        <span className="llamado__ayuda">
          {[TEXTO_DE_TIPO[llamado.tipo], quien, cuando ? horaDeLima(cuando) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <EtiquetaDeEstado
        tono={
          estado === 'PASADO_A_CUENTA' || estado === 'ATENDIDO'
            ? 'ok'
            : estado === 'VENCIDO'
              ? 'alerta'
              : 'neutro'
        }
      >
        {TEXTO_DE_ESTADO_CERRADO[estado] ?? estado}
      </EtiquetaDeEstado>
    </Link>
  );
}
