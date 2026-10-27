import type { EquipoRecordadoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  DialogoConfirmacion,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  IconoCelular,
  ListaDeFilas,
  claseFila,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pagina } from '../../componentes/Pagina';
import { listarMisEquipos, olvidarMiEquipo } from '../../lib/equipo';
import { mensajeDeError } from '../../lib/errores';
import { fechaHoraDeLima } from '../../lib/formato';
import { useSesion } from './sesion';

const CLAVE_MIS_EQUIPOS = ['mis-equipos'] as const;

/** Mis equipos (criterio 97): dónde me recuerda la app, con la opción de olvidar cualquiera. */
export function MisEquiposPagina() {
  const { soltarSesion } = useSesion();
  const clientes = useQueryClient();
  const [paraOlvidar, setParaOlvidar] = useState<EquipoRecordadoRespuesta | null>(null);
  const [olvidando, setOlvidando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consulta = useQuery({
    queryKey: CLAVE_MIS_EQUIPOS,
    queryFn: ({ signal }) => listarMisEquipos(signal),
  });
  const equipos = consulta.data ?? [];

  function cerrar() {
    setParaOlvidar(null);
    setError(null);
  }

  async function olvidar() {
    if (!paraOlvidar) return;
    setOlvidando(true);
    setError(null);
    try {
      await olvidarMiEquipo(paraOlvidar.id);
      if (paraOlvidar.actual) {
        // Olvidar el equipo de esta sesión la cierra: ya no hay nada más que hacer aquí.
        soltarSesion('/pin');
        return;
      }
      setParaOlvidar(null);
      await clientes.invalidateQueries({ queryKey: CLAVE_MIS_EQUIPOS });
    } catch (e) {
      setError(mensajeDeError(e, { NO_ENCONTRADO: 'Ese equipo ya no está en tu lista.' }));
      void clientes.invalidateQueries({ queryKey: CLAVE_MIS_EQUIPOS });
    } finally {
      setOlvidando(false);
    }
  }

  return (
    <Pagina titulo="Mis equipos" atras={{ a: '/', etiqueta: 'Inicio' }}>
      <p className="ui-subtitulo">
        Estos son los equipos donde ingresas con tu PIN. Olvida el que ya no uses o hayas perdido.
      </p>

      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando tus equipos" conInicial={false} filas={3} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar tus equipos"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : equipos.length === 0 ? (
        <EstadoVacio icono={IconoCelular} titulo="Ningún equipo te recuerda">
          La próxima vez que ingreses con tu usuario y contraseña, este equipo te recordará y podrás
          entrar con tu PIN.
        </EstadoVacio>
      ) : (
        <ListaDeFilas etiqueta="Mis equipos">
          {equipos.map((e) => (
            <li key={e.id}>
              <div className={`${claseFila()} fila--con-boton`}>
                <ContenidoDeFila
                  titulo={e.equipo.nombre}
                  ayuda={`Último uso: ${fechaHoraDeLima(e.ultimoUsoEn)}`}
                  derecha={
                    e.actual ? <EtiquetaDeEstado tono="info">Este equipo</EtiquetaDeEstado> : null
                  }
                />
                <Boton bloque onClick={() => setParaOlvidar(e)}>
                  Olvidar <span className="ui-solo-lectores">{e.equipo.nombre}</span>
                </Boton>
              </div>
            </li>
          ))}
        </ListaDeFilas>
      )}

      <DialogoConfirmacion
        abierta={paraOlvidar !== null}
        titulo={paraOlvidar?.actual ? 'Olvidar este equipo' : 'Olvidar un equipo'}
        etiquetaConfirmar="Olvidar"
        peligro
        cargando={olvidando}
        textoCargando="Olvidando…"
        error={
          error ? (
            <Aviso tipo="error" titulo="No pudimos hacerlo">
              {error}
            </Aviso>
          ) : null
        }
        onConfirmar={() => void olvidar()}
        onCancelar={cerrar}
      >
        {paraOlvidar?.actual
          ? 'Este equipo dejará de recordarte y se cerrará tu sesión. Para volver a entrar tendrás que ingresar con tu usuario y contraseña.'
          : `${paraOlvidar?.equipo.nombre ?? 'Ese equipo'} dejará de recordarte. Si tenías una sesión abierta ahí, se cerrará; para volver a entrar tendrás que ingresar con tu usuario y contraseña.`}
      </DialogoConfirmacion>
    </Pagina>
  );
}
