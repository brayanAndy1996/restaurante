import type { EquipoRecordadoRespuesta, UsuarioRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  IconoOlvidar,
  ListaDeFilas,
  claseFila,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  listarEquiposDeUsuario,
  revocarEquipoDeUsuario,
  revocarEquiposDeUsuario,
} from '../../lib/equipo';
import { mensajeDeError } from '../../lib/errores';
import { fechaHoraDeLima } from '../../lib/formato';

type Pendiente = { tipo: 'uno'; equipo: EquipoRecordadoRespuesta } | { tipo: 'todos' };

/**
 * Equipos recordados de un usuario (criterios 30 y 100): dónde puede entrar con PIN, con la opción de
 * olvidar uno o todos. Al hacerlo, su PIN deja de servir ahí y se cierran sus sesiones de esos equipos.
 */
export function EquiposDeUsuario({ usuario }: { usuario: UsuarioRespuesta }) {
  const clientes = useQueryClient();
  const clave = ['usuarios', usuario.id, 'equipos'] as const;
  const consulta = useQuery({
    queryKey: clave,
    queryFn: ({ signal }) => listarEquiposDeUsuario(usuario.id, signal),
  });
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const equipos = consulta.data ?? [];

  function cerrar() {
    setPendiente(null);
    setError(null);
  }

  async function confirmar() {
    if (!pendiente) return;
    setTrabajando(true);
    setError(null);
    try {
      if (pendiente.tipo === 'uno') await revocarEquipoDeUsuario(usuario.id, pendiente.equipo.id);
      else await revocarEquiposDeUsuario(usuario.id);
      setPendiente(null);
      await clientes.invalidateQueries({ queryKey: clave });
    } catch (e) {
      setError(mensajeDeError(e, { NO_ENCONTRADO: 'Ese equipo ya no está en la lista.' }));
      void clientes.invalidateQueries({ queryKey: clave });
    } finally {
      setTrabajando(false);
    }
  }

  const nombre = usuario.nombre;
  return (
    <section className="formulario__aparte" aria-label="Equipos recordados">
      <h2 className="formulario__titulo">Equipos recordados</h2>
      <p className="texto-ayuda">
        Los equipos donde {nombre} puede entrar con su PIN. Si perdió un celular o ya no lo usa,
        olvídalo aquí: su PIN dejará de servir en ese equipo.
      </p>

      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando equipos" conInicial={false} filas={2} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los equipos"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : equipos.length === 0 ? (
        <p>
          Ningún equipo recuerda a {nombre}. Entrará con PIN después de ingresar una vez con su
          contraseña en cada equipo.
        </p>
      ) : (
        <>
          <ListaDeFilas etiqueta="Equipos recordados">
            {equipos.map((e) => (
              <li key={e.id}>
                <div className={`${claseFila()} fila--con-boton`}>
                  <ContenidoDeFila
                    titulo={e.equipo.nombre}
                    ayuda={`Último uso: ${fechaHoraDeLima(e.ultimoUsoEn)}`}
                  />
                  <Boton bloque onClick={() => setPendiente({ tipo: 'uno', equipo: e })}>
                    Olvidar <span className="ui-solo-lectores">{e.equipo.nombre}</span>
                  </Boton>
                </div>
              </li>
            ))}
          </ListaDeFilas>
          <Boton
            bloque
            variante="peligro"
            icono={IconoOlvidar}
            onClick={() => setPendiente({ tipo: 'todos' })}
          >
            Olvidar todos los equipos
          </Boton>
        </>
      )}

      <DialogoConfirmacion
        abierta={pendiente !== null}
        titulo={pendiente?.tipo === 'todos' ? 'Olvidar todos los equipos' : 'Olvidar un equipo'}
        etiquetaConfirmar={pendiente?.tipo === 'todos' ? 'Olvidar todos' : 'Olvidar'}
        peligro
        cargando={trabajando}
        textoCargando="Olvidando…"
        error={
          error ? (
            <Aviso tipo="error" titulo="No pudimos hacerlo">
              {error}
            </Aviso>
          ) : null
        }
        onConfirmar={() => void confirmar()}
        onCancelar={cerrar}
      >
        {pendiente?.tipo === 'todos'
          ? `El PIN de ${nombre} dejará de servir en todos sus equipos y se cerrarán sus sesiones en ellos. Para volver a entrar con PIN tendrá que ingresar con su contraseña en cada uno.`
          : `El PIN de ${nombre} dejará de servir en ${pendiente?.equipo.equipo.nombre ?? 'ese equipo'} y se cerrarán sus sesiones ahí. Las demás personas de ese equipo no se ven afectadas.`}
      </DialogoConfirmacion>
    </section>
  );
}
