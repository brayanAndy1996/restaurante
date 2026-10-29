import type { UsuarioRespuesta } from '@restaurante/contratos';
import {
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoMas,
  IconoReloj,
  IconoLlave,
  IconoUsuarios,
  TablaResponsiva,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { mensajeDeError } from '../../lib/errores';
import { useSesionActiva } from '../acceso/sesion';
import { MarcoDeAjustes } from './MarcoDeAjustes';
import {
  CLAVE_USUARIOS,
  listarUsuarios,
  resumenDeAccesos,
  type NombresDeSucursal,
} from './usuarios';

function Etiquetas({ usuario }: { usuario: UsuarioRespuesta }) {
  const conHorario = usuario.activo && usuario.horario !== null;
  const temporal = usuario.activo && usuario.contrasenaTemporal;
  if (usuario.activo && !conHorario && !temporal) return null;
  return (
    <span className="etiquetas">
      {!usuario.activo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : null}
      {conHorario ? (
        <EtiquetaDeEstado tono="info" icono={IconoReloj}>
          Con horario
        </EtiquetaDeEstado>
      ) : null}
      {temporal ? (
        <EtiquetaDeEstado tono="alerta" icono={IconoLlave}>
          Contraseña temporal
        </EtiquetaDeEstado>
      ) : null}
    </span>
  );
}

/** Lista de usuarios (criterio 100): filas de 72 px en celular, tabla desde 768 px. */
export function UsuariosPagina() {
  const sesion = useSesionActiva();
  const [busqueda, setBusqueda] = useState('');
  const consulta = useQuery({
    queryKey: CLAVE_USUARIOS,
    queryFn: ({ signal }) => listarUsuarios(signal),
  });
  const sucursales: NombresDeSucursal = useMemo(
    () => new Map(sesion.sucursales.map((s) => [s.id, s.nombre])),
    [sesion.sucursales],
  );

  const todos = consulta.data ?? [];
  const texto = busqueda.trim().toLowerCase();
  const visibles = texto
    ? todos.filter((u) => u.nombre.toLowerCase().includes(texto) || u.nombreUsuario.includes(texto))
    : todos;
  const inactivos = todos.filter((u) => !u.activo).length;

  return (
    <MarcoDeAjustes
      actual="usuarios"
      ancho="ancho"
      pie={
        <Link
          to="/administracion/usuarios/nuevo"
          className={`${claseBoton('principal')} boton-pie`}
        >
          <Icono icono={IconoMas} />
          Agregar usuario
        </Link>
      }
    >
      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando usuarios" />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los usuarios"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : todos.length === 0 ? (
        <EstadoVacio
          icono={IconoUsuarios}
          titulo="Aún no hay usuarios"
          accion={
            <Link to="/administracion/usuarios/nuevo" className={claseBoton('principal')}>
              <Icono icono={IconoMas} tamano={20} />
              Agregar usuario
            </Link>
          }
        >
          Agrega a tu primer trabajador para que pueda ingresar con su usuario.
        </EstadoVacio>
      ) : (
        <>
          <p className="texto-ayuda" aria-live="polite">
            {todos.length === 1 ? '1 usuario' : `${todos.length} usuarios`}
            {inactivos > 0 ? ` · ${inactivos === 1 ? '1 inactivo' : `${inactivos} inactivos`}` : ''}
          </p>
          {todos.length > 6 ? (
            <CampoTexto
              className="campo-busqueda"
              etiqueta="Buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre o usuario"
              autoComplete="off"
            />
          ) : null}
          {visibles.length === 0 ? (
            <EstadoVacio icono={IconoUsuarios} titulo="No encontramos a nadie">
              Prueba con otro nombre o con el nombre de usuario.
            </EstadoVacio>
          ) : (
            <TablaResponsiva
              etiqueta="Usuarios"
              filas={visibles}
              clave={(u) => u.id}
              apagada={(u) => !u.activo}
              filaEnLista={(u) => (
                <Link to={`/administracion/usuarios/${u.id}`} className={claseFila(!u.activo)}>
                  <ContenidoDeFila
                    inicial={u.nombre}
                    apagada={!u.activo}
                    titulo={u.nombre}
                    ayuda={resumenDeAccesos(u, sucursales)}
                    derecha={<Icono icono={IconoDerecha} />}
                    extra={<Etiquetas usuario={u} />}
                  />
                </Link>
              )}
              columnas={[
                {
                  id: 'nombre',
                  encabezado: 'Nombre',
                  celda: (u) => (
                    <>
                      <Link
                        to={`/administracion/usuarios/${u.id}`}
                        className="enlace-texto enlace-nombre"
                      >
                        {u.nombre}
                      </Link>
                      <br />
                      <span className="texto-ayuda">{u.nombreUsuario}</span>
                    </>
                  ),
                },
                {
                  id: 'acceso',
                  encabezado: 'Rol y sucursal',
                  celda: (u) => resumenDeAccesos(u, sucursales),
                },
                {
                  id: 'pin',
                  encabezado: 'PIN',
                  sinSaltos: true,
                  celda: (u) => `${u.largoPin} dígitos`,
                },
                { id: 'estado', encabezado: 'Estado', celda: (u) => <Etiquetas usuario={u} /> },
                {
                  id: 'acciones',
                  encabezado: 'Acciones',
                  encabezadoOculto: true,
                  alinear: 'derecha',
                  sinSaltos: true,
                  celda: (u) => (
                    <Link to={`/administracion/usuarios/${u.id}`} className={claseBoton()}>
                      Ver y editar <span className="ui-solo-lectores">{`a ${u.nombre}`}</span>
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </MarcoDeAjustes>
  );
}
