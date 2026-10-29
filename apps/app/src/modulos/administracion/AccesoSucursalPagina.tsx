import { Aviso, Boton, CampoTexto, ErrorDeCarga, EsqueletoDeLista } from '@restaurante/ui';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { mensajeDeError } from '../../lib/errores';
import { useSesionActiva } from '../acceso/sesion';
import {
  MAXIMO_MINUTOS,
  MAXIMO_MINUTOS_COCINA,
  MINIMO_MINUTOS,
  claveAccesoSucursal,
  configurarAccesoSucursal,
  minutosValidos,
  obtenerAccesoSucursal,
} from './acceso-sucursal';
import { MarcoDeAjustes } from './MarcoDeAjustes';

type Campo = 'general' | 'cocina';
const clave = (sucursalId: string, campo: Campo) => `${sucursalId}:${campo}`;

/**
 * Acceso de la sucursal (criterio 100 de 002 y 63c de 004): los minutos sin uso tras los que se cierra
 * una sesión, uno para todos los roles y otro, más largo, para Cocina y Barra. Solo el Administrador; el
 * cambio rige desde la siguiente petición de las sesiones abiertas.
 */
export function AccesoSucursalPagina() {
  const sesion = useSesionActiva();
  const clientes = useQueryClient();
  const consultas = useQueries({
    queries: sesion.sucursales.map((s) => ({
      queryKey: claveAccesoSucursal(s.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => obtenerAccesoSucursal(s.id, signal),
    })),
  });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Un corte de red no pierde el cambio: queda "Pendiente de envío" y sale solo al volver la red.
  const envio = useEnvioPendiente();

  const cargando = consultas.some((c) => c.isPending);
  const conError = consultas.find((c) => c.isError);

  const filas = sesion.sucursales.map((s, i) => {
    const datos = consultas[i]?.data;
    const guardadoGeneral = datos?.minutosInactividad;
    const guardadoCocina = datos?.minutosInactividadCocina;
    return {
      sucursal: s,
      guardadoGeneral,
      guardadoCocina,
      general:
        valores[clave(s.id, 'general')] ??
        (guardadoGeneral === undefined ? '' : String(guardadoGeneral)),
      cocina:
        valores[clave(s.id, 'cocina')] ??
        (guardadoCocina === undefined ? '' : String(guardadoCocina)),
    };
  });
  const cambio = (texto: string, guardadoEnServidor: number | undefined) =>
    guardadoEnServidor !== undefined && texto.trim() !== String(guardadoEnServidor);
  const cambiadas = filas.filter(
    (f) => cambio(f.general, f.guardadoGeneral) || cambio(f.cocina, f.guardadoCocina),
  );

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos: Record<string, string> = {};
    for (const f of cambiadas) {
      if (cambio(f.general, f.guardadoGeneral) && minutosValidos(f.general) === null) {
        nuevos[clave(f.sucursal.id, 'general')] =
          `Escribe un número entero de ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS}`;
      }
      if (
        cambio(f.cocina, f.guardadoCocina) &&
        minutosValidos(f.cocina, MAXIMO_MINUTOS_COCINA) === null
      ) {
        nuevos[clave(f.sucursal.id, 'cocina')] =
          `Escribe un número entero de ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS_COCINA}`;
      }
    }
    setErrores(nuevos);
    setFallo(null);
    setGuardado(false);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    const fallidas: string[] = [];
    let ultimoError: unknown = null;
    for (const f of cambiadas) {
      const cambios: { minutosInactividad?: number; minutosInactividadCocina?: number } = {};
      if (cambio(f.general, f.guardadoGeneral))
        cambios.minutosInactividad = minutosValidos(f.general)!;
      if (cambio(f.cocina, f.guardadoCocina)) {
        cambios.minutosInactividadCocina = minutosValidos(f.cocina, MAXIMO_MINUTOS_COCINA)!;
      }
      try {
        const respuesta = await envio.enviar((extra) =>
          configurarAccesoSucursal(f.sucursal.id, cambios, extra),
        );
        clientes.setQueryData(claveAccesoSucursal(f.sucursal.id), respuesta);
        setValores((v) => {
          const {
            [clave(f.sucursal.id, 'general')]: _general,
            [clave(f.sucursal.id, 'cocina')]: _cocina,
            ...resto
          } = v;
          return resto;
        });
      } catch (error) {
        fallidas.push(f.sucursal.nombre);
        ultimoError = error;
      }
    }
    setEnviando(false);
    if (fallidas.length > 0) {
      setFallo(
        `No pudimos guardar ${fallidas.length === 1 ? 'la sucursal' : 'las sucursales'} ${fallidas.join(', ')}. ${mensajeDeError(ultimoError)}`,
      );
    } else {
      setGuardado(true);
    }
  }

  return (
    <MarcoDeAjustes
      actual="acceso"
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-acceso"
          cargando={enviando}
          textoCargando="Guardando…"
          disabled={cargando || cambiadas.length === 0}
        >
          Guardar cambios
        </Boton>
      }
    >
      <div>
        <h2 className="ui-titulo">Cierre por inactividad</h2>
        <p className="ui-subtitulo">
          Cuando nadie toca la pantalla durante estos minutos, la sesión con PIN se cierra y se pide
          el PIN de nuevo. La sesión con contraseña dura 30 minutos.
        </p>
        <p className="ui-subtitulo">
          Cocina y Barra dejan la pantalla encendida durante el servicio, así que tienen su propio
          tiempo, con PIN o con contraseña.
        </p>
      </div>

      <AvisoPendiente pendiente={envio.pendiente} />
      {guardado ? (
        <Aviso tipo="ok" titulo="Cambios guardados">
          Rigen desde la siguiente acción de quienes ya están dentro.
        </Aviso>
      ) : null}
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos guardar">
          {fallo}
        </Aviso>
      ) : null}

      {cargando ? (
        <EsqueletoDeLista etiqueta="Cargando las sucursales" conInicial={false} filas={2} />
      ) : conError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar el acceso de las sucursales"
          onReintentar={() => consultas.forEach((c) => void c.refetch())}
          reintentando={consultas.some((c) => c.isFetching)}
        >
          {mensajeDeError(conError.error)}
        </ErrorDeCarga>
      ) : (
        <form id="formulario-acceso" className="formulario" onSubmit={guardar} noValidate>
          {filas.map((f) => (
            <fieldset key={f.sucursal.id} className="acceso__sucursal">
              <legend className="formulario__titulo">{f.sucursal.nombre}</legend>
              <CampoTexto
                etiqueta="Cierre por inactividad (minutos)"
                inputMode="numeric"
                autoComplete="off"
                value={f.general}
                onChange={(e) => {
                  setValores((v) => ({ ...v, [clave(f.sucursal.id, 'general')]: e.target.value }));
                  setGuardado(false);
                }}
                error={errores[clave(f.sucursal.id, 'general')]}
                ayuda={`De ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS} minutos. Ahora: ${f.guardadoGeneral ?? '—'}.`}
              />
              <CampoTexto
                etiqueta="Cierre por inactividad de Cocina y Barra (minutos)"
                inputMode="numeric"
                autoComplete="off"
                value={f.cocina}
                onChange={(e) => {
                  setValores((v) => ({ ...v, [clave(f.sucursal.id, 'cocina')]: e.target.value }));
                  setGuardado(false);
                }}
                error={errores[clave(f.sucursal.id, 'cocina')]}
                ayuda={`De ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS_COCINA} minutos. Ahora: ${f.guardadoCocina ?? '—'}.`}
              />
            </fieldset>
          ))}
        </form>
      )}
    </MarcoDeAjustes>
  );
}
