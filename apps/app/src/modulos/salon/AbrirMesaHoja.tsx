import { MAXIMO_COMENSALES } from '@restaurante/dominio';
import {
  Aviso,
  BaldosaDeOpcion,
  Boton,
  ContadorGrande,
  Hoja,
  IconoPersona,
  Inicial,
} from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeError } from '../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { abrirOrden, rutaDeOrden } from './salon';

export interface MesaPorAbrir {
  id: string;
  nombre: string;
  capacidad: number;
}

const MENSAJES = {
  NO_ENCONTRADO: 'Esta mesa ya no está en tu sucursal. Actualiza el salón e inténtalo de nuevo.',
  CONFLICTO: 'Esta mesa está desactivada. Pide al administrador que la active.',
} as const;

/**
 * Hoja "Abrir mesa" (criterio 89 de 004): los comensales (por defecto la capacidad de la mesa) y el mozo
 * responsable (por defecto, tú; decisión 8). Si la mesa se abrió justo antes en otro equipo, lo dice y lleva
 * a su cuenta.
 */
export function AbrirMesaHoja({
  mesa,
  mozos,
  onCerrar,
}: {
  mesa: MesaPorAbrir | null;
  /** Las personas que pueden atender mesas en la sucursal (`mozos` de `GET /salon`), por nombre. */
  mozos: readonly { id: string; nombre: string }[];
  onCerrar: () => void;
}) {
  return (
    <Hoja
      abierta={mesa !== null}
      onCerrar={onCerrar}
      titulo={
        mesa
          ? `Abrir ${/^mesa\b/i.test(mesa.nombre.trim()) ? '' : 'mesa '}${mesa.nombre}`
          : 'Abrir mesa'
      }
    >
      {mesa ? (
        <FormularioDeApertura key={mesa.id} mesa={mesa} mozos={mozos} onCerrar={onCerrar} />
      ) : null}
    </Hoja>
  );
}

function FormularioDeApertura({
  mesa,
  mozos,
  onCerrar,
}: {
  mesa: MesaPorAbrir;
  mozos: readonly { id: string; nombre: string }[];
  onCerrar: () => void;
}) {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const idDelMozo = useId();
  const envio = useEnvioPendiente();

  const yo = sesion.usuario;
  // Una sesión de soporte no es una persona de la empresa: tiene que elegir quién atiende (criterio 10).
  const debeElegir = yo === null;
  // Las demás personas que atienden mesas (las trae `GET /salon`); sin ellas no hay a quién cambiar.
  const otras = mozos.filter((m) => m.id !== yo?.id);
  const puedeElegir = otras.length > 0;

  // El `id` de la orden lo genera esta pantalla y se conserva en los reintentos: abrir dos veces la misma
  // mesa con el mismo `id` devuelve la misma orden, no abre otra (criterio 12).
  const [ordenId] = useState(() => nuevaClaveDeIdempotencia());
  const [comensales, setComensales] = useState(() =>
    Math.min(Math.max(mesa.capacidad, 1), MAXIMO_COMENSALES),
  );
  const [eligiendo, setEligiendo] = useState(debeElegir);
  const [mozoId, setMozoId] = useState<string | null>(yo?.id ?? null);
  const [fallo, setFallo] = useState<string | null>(null);

  const abrir = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: () =>
      envio.enviar((extra) =>
        abrirOrden(
          {
            id: ordenId,
            mesaId: mesa.id,
            comensales,
            // Sin `mozoId`, la responsable es quien abre; solo se manda si es otra persona.
            ...(mozoId !== null && mozoId !== yo?.id ? { mozoId } : {}),
          },
          extra,
        ),
      ),
    onSuccess: (orden) => {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      if (envio.sigueMontada()) {
        onCerrar();
        navegar(rutaDeOrden(orden.id));
      }
    },
    onError: (error) => {
      if (!envio.sigueMontada()) return;
      if (error instanceof ErrorApi && error.codigo === 'MESA_OCUPADA') {
        // Otra persona se adelantó: el mapa se actualiza y se va directo a su cuenta.
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
        if (error.ordenId) {
          onCerrar();
          navegar(rutaDeOrden(error.ordenId), { state: { mesaOcupada: true } });
          return;
        }
      }
      if (error instanceof ErrorApi && erroresPorCampo(error).mozoId !== undefined) {
        setFallo('Esa persona ya no puede atender mesas en esta sucursal. Elige a otra.');
        return;
      }
      setFallo(mensajeDeError(error, MENSAJES));
    },
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (abrir.isPending) return;
    setFallo(null);
    abrir.mutate();
  }

  const faltaElegir = debeElegir && mozoId === null;

  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <section className="salon-apertura__bloque" aria-labelledby={`${idDelMozo}-comensales`}>
        <h3 className="ui-campo__etiqueta" id={`${idDelMozo}-comensales`}>
          Comensales
        </h3>
        <ContadorGrande
          nombre="comensales"
          unidad={comensales === 1 ? 'comensal' : 'comensales'}
          valor={comensales}
          minimo={1}
          maximo={MAXIMO_COMENSALES}
          onCambio={setComensales}
        />
        <p className="ui-campo__ayuda">
          La mesa es para {mesa.capacidad} {mesa.capacidad === 1 ? 'persona' : 'personas'}.
        </p>
      </section>

      <section className="salon-apertura__bloque" aria-labelledby={idDelMozo}>
        <h3 className="ui-campo__etiqueta" id={idDelMozo}>
          Mozo responsable
        </h3>
        {!eligiendo ? (
          <div className="salon-apertura__persona">
            <Inicial nombre={yo?.nombre ?? '?'} />
            <span className="ui-fila__texto">
              <span className="ui-fila__titulo">Tú</span>
              <span className="ui-fila__ayuda">{yo?.nombre}</span>
            </span>
            {puedeElegir ? (
              <Boton variante="texto" onClick={() => setEligiendo(true)}>
                Cambiar
              </Boton>
            ) : null}
          </div>
        ) : (
          <div className="salon-apertura__personas" role="group" aria-labelledby={idDelMozo}>
            {yo ? (
              <BaldosaDeOpcion
                titulo="Tú"
                detalle={yo.nombre}
                activa={mozoId === yo.id}
                onElegir={() => setMozoId(yo.id)}
              />
            ) : null}
            {otras.map((p) => (
              <BaldosaDeOpcion
                key={p.id}
                titulo={p.nombre}
                activa={mozoId === p.id}
                onElegir={() => setMozoId(p.id)}
              />
            ))}
            {otras.length === 0 && !yo ? (
              <Aviso tipo="alerta" titulo="No hay quién atienda mesas">
                Ninguna persona de esta sucursal puede atender mesas. Revisa los usuarios en
                Ajustes.
              </Aviso>
            ) : null}
            {!debeElegir ? (
              <Boton
                variante="texto"
                icono={IconoPersona}
                onClick={() => {
                  setMozoId(yo?.id ?? null);
                  setEligiendo(false);
                }}
              >
                Volver a mí
              </Boton>
            ) : null}
          </div>
        )}
        {faltaElegir ? (
          <p className="ui-campo__ayuda">Elige quién atenderá la mesa para poder abrirla.</p>
        ) : null}
      </section>

      <AvisoPendiente pendiente={envio.pendiente} />
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos abrir la mesa">
          {fallo}
        </Aviso>
      ) : null}
      <Boton
        type="submit"
        variante="principal"
        bloque
        cargando={abrir.isPending}
        textoCargando="Abriendo…"
        disabled={faltaElegir}
      >
        Abrir mesa
      </Boton>
      <Boton bloque onClick={onCerrar} disabled={abrir.isPending}>
        Cancelar
      </Boton>
    </form>
  );
}
