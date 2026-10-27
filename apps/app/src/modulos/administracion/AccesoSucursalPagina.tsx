import { Aviso, Boton, CampoTexto, ErrorDeCarga, EsqueletoDeLista } from '@restaurante/ui';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Pagina } from '../../componentes/Pagina';
import { mensajeDeError } from '../../lib/errores';
import { useSesionActiva } from '../acceso/sesion';
import {
  MAXIMO_MINUTOS,
  MINIMO_MINUTOS,
  claveAccesoSucursal,
  configurarAccesoSucursal,
  minutosValidos,
  obtenerAccesoSucursal,
} from './acceso-sucursal';

/**
 * Acceso de la sucursal (criterio 100): los minutos sin uso tras los que se cierra una sesión con PIN.
 * Solo el Administrador; el cambio rige desde la siguiente petición de las sesiones abiertas.
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

  const cargando = consultas.some((c) => c.isPending);
  const conError = consultas.find((c) => c.isError);

  const filas = sesion.sucursales.map((s, i) => {
    const guardadoEnServidor = consultas[i]?.data?.minutosInactividad;
    const texto =
      valores[s.id] ?? (guardadoEnServidor === undefined ? '' : String(guardadoEnServidor));
    return { sucursal: s, guardadoEnServidor, texto };
  });
  const cambiadas = filas.filter(
    (f) => f.guardadoEnServidor !== undefined && f.texto.trim() !== String(f.guardadoEnServidor),
  );

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos: Record<string, string> = {};
    for (const f of cambiadas) {
      if (minutosValidos(f.texto) === null) {
        nuevos[f.sucursal.id] = `Escribe un número entero de ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS}`;
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
      try {
        const respuesta = await configurarAccesoSucursal(f.sucursal.id, minutosValidos(f.texto)!);
        clientes.setQueryData(claveAccesoSucursal(f.sucursal.id), respuesta);
        setValores((v) => {
          const { [f.sucursal.id]: _listo, ...resto } = v;
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
    <Pagina
      titulo="Acceso"
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
      </div>

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
            <CampoTexto
              key={f.sucursal.id}
              etiqueta={`${f.sucursal.nombre}: minutos sin uso`}
              inputMode="numeric"
              autoComplete="off"
              value={f.texto}
              onChange={(e) => {
                setValores((v) => ({ ...v, [f.sucursal.id]: e.target.value }));
                setGuardado(false);
              }}
              error={errores[f.sucursal.id]}
              ayuda={`De ${MINIMO_MINUTOS} a ${MAXIMO_MINUTOS} minutos. Ahora: ${f.guardadoEnServidor ?? '—'}.`}
            />
          ))}
        </form>
      )}
    </Pagina>
  );
}
