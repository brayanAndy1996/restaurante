import type { UsuarioRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoSeleccion,
  CampoTexto,
  EditorDeHorario,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  IconoAzar,
  IconoReloj,
  Interruptor,
  Icono,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, erroresPorCampo, mensajeDeError } from '../../lib/errores';
import { etiquetaDeRol } from '../../lib/formato';
import { useSesionActiva } from '../acceso/sesion';
import { AccionesDeUsuario } from './AccionesDeUsuario';
import { PinCreadoVista } from './PinCreadoVista';
import {
  CLAVE_USUARIOS,
  ROLES_ASIGNABLES,
  cambiosDelUsuario,
  crearUsuario,
  entradaDeCreacion,
  formularioDeUsuario,
  formularioVacio,
  generarContrasenaTemporal,
  hayCambios,
  largoDePinDelFormulario,
  modificarUsuario,
  obtenerUsuario,
  validarFormulario,
  type ErroresDelFormulario,
  type EstadoDelFormulario,
} from './usuarios';

const MENSAJES = {
  ULTIMO_ADMINISTRADOR:
    'La empresa no puede quedarse sin un administrador activo. Nombra a otro antes de quitarle el rol a esta persona.',
  SUCURSAL_INVALIDA:
    'Una de las sucursales elegidas no es válida. Actualiza la pantalla e inténtalo de nuevo.',
} as const;

function comoErrorApi(e: unknown): ErrorApi {
  return e instanceof ErrorApi
    ? e
    : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
}

/** Alta de usuario. */
export function UsuarioNuevoPagina() {
  return <FormularioDeUsuario modo="crear" />;
}

/** Edición de un usuario existente: carga el usuario y muestra el mismo formulario. */
export function UsuarioEditarPagina() {
  const { id = '' } = useParams();
  const consulta = useQuery({
    queryKey: [...CLAVE_USUARIOS, id],
    queryFn: ({ signal }) => obtenerUsuario(id, signal),
  });
  if (consulta.isPending) {
    return (
      <Pagina titulo="Usuario" atras={{ a: '/administracion/usuarios', etiqueta: 'Usuarios' }}>
        <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando usuario" />
      </Pagina>
    );
  }
  if (consulta.isError) {
    const noExiste =
      consulta.error instanceof ErrorApi && consulta.error.codigo === 'NO_ENCONTRADO';
    return (
      <Pagina titulo="Usuario" atras={{ a: '/administracion/usuarios', etiqueta: 'Usuarios' }}>
        <ErrorDeCarga
          titulo={noExiste ? 'No encontramos a este usuario' : 'No pudimos cargar al usuario'}
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {noExiste
            ? 'Puede que ya no exista. Vuelve a la lista de usuarios.'
            : mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  return <FormularioDeUsuario key={consulta.data.id} modo="editar" original={consulta.data} />;
}

type Vista =
  | { tipo: 'formulario' }
  | {
      tipo: 'pin';
      titulo: string;
      pin: string;
      aviso: { titulo: string; texto: string };
      contrasena?: string;
    };

interface PropsFormulario {
  modo: 'crear' | 'editar';
  original?: UsuarioRespuesta;
}

function FormularioDeUsuario({ modo, original }: PropsFormulario) {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const [usuarioGuardado, setUsuarioGuardado] = useState<UsuarioRespuesta | undefined>(original);
  const [estado, setEstado] = useState<EstadoDelFormulario>(() =>
    original ? formularioDeUsuario(original) : formularioVacio(),
  );
  const [errores, setErrores] = useState<ErroresDelFormulario>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [vista, setVista] = useState<Vista>({ tipo: 'formulario' });

  const cambios = usuarioGuardado ? cambiosDelUsuario(usuarioGuardado, estado) : {};
  const sinCambios = modo === 'editar' && !hayCambios(cambios);
  const largo = largoDePinDelFormulario(estado);
  const erroresActuales = validarFormulario(estado, modo);
  const horarioConError =
    Boolean(erroresActuales.horario) && estado.limitarHorario && estado.horario.length > 0;

  function cambiar(parcial: Partial<EstadoDelFormulario>) {
    setEstado((e) => ({ ...e, ...parcial }));
    setGuardado(false);
  }

  function volverALista() {
    void clientes.invalidateQueries({ queryKey: CLAVE_USUARIOS });
    navegar('/administracion/usuarios', { replace: true });
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = validarFormulario(estado, modo);
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      if (modo === 'crear') {
        const creado = await crearUsuario(entradaDeCreacion(estado));
        void clientes.invalidateQueries({ queryKey: CLAVE_USUARIOS });
        setVista({
          tipo: 'pin',
          titulo: 'Usuario creado',
          pin: creado.pin,
          contrasena: estado.contrasenaTemporal,
          aviso: {
            titulo: `${creado.nombre} ya puede ingresar`,
            texto: 'Con su usuario y su contraseña temporal. Al entrar, la cambiará.',
          },
        });
      } else if (original) {
        const actualizado = await modificarUsuario(original.id, cambios);
        const { pin, ...usuario } = actualizado;
        clientes.setQueryData([...CLAVE_USUARIOS, original.id], usuario);
        void clientes.invalidateQueries({ queryKey: CLAVE_USUARIOS });
        setUsuarioGuardado(usuario);
        setEstado(formularioDeUsuario(usuario));
        if (pin) {
          setVista({
            tipo: 'pin',
            titulo: 'PIN nuevo',
            pin,
            aviso: {
              titulo: `Cambió el largo del PIN de ${usuario.nombre}`,
              texto: `Ahora tiene ${usuario.largoPin} dígitos. El anterior dejó de funcionar.`,
            },
          });
        } else {
          setGuardado(true);
        }
      }
    } catch (e) {
      const error = comoErrorApi(e);
      const campos = erroresPorCampo(error);
      if (error.codigo === 'CONFLICTO' && modo === 'crear') {
        if (error.reintentada) {
          setFallo(
            'La conexión se cortó mientras se guardaba y es posible que el usuario ya se haya creado. Revisa la lista de usuarios antes de intentarlo otra vez.',
          );
        } else {
          setErrores({ nombreUsuario: 'Ese nombre de usuario ya está en uso. Elige otro.' });
        }
      } else if (error.codigo === 'SUCURSAL_INVALIDA') {
        setErrores({ accesos: MENSAJES.SUCURSAL_INVALIDA });
      } else if (error.codigo === 'DATOS_INVALIDOS' && Object.keys(campos).length > 0) {
        const porCampo: ErroresDelFormulario = {};
        for (const [campo, mensaje] of Object.entries(campos)) {
          const raiz = campo.split('.')[0];
          if (
            raiz === 'nombre' ||
            raiz === 'nombreUsuario' ||
            raiz === 'contrasenaTemporal' ||
            raiz === 'accesos' ||
            raiz === 'horario'
          ) {
            porCampo[raiz] = mensaje;
          }
        }
        setErrores(porCampo);
        setFallo(mensajeDeError(error));
      } else {
        setFallo(mensajeDeError(error, MENSAJES));
      }
    } finally {
      setEnviando(false);
    }
  }

  if (vista.tipo === 'pin') {
    return (
      <PinCreadoVista
        titulo={vista.titulo}
        nombre={usuarioGuardado?.nombre ?? estado.nombre.trim()}
        pin={vista.pin}
        aviso={vista.aviso}
        {...(vista.contrasena ? { contrasenaTemporal: vista.contrasena } : {})}
        onListo={() => (modo === 'crear' ? volverALista() : setVista({ tipo: 'formulario' }))}
      />
    );
  }

  const titulo = modo === 'crear' ? 'Agregar usuario' : (usuarioGuardado?.nombre ?? 'Usuario');

  return (
    <Pagina
      titulo={titulo}
      atras={{ a: '/administracion/usuarios', etiqueta: 'Usuarios' }}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-usuario"
          cargando={enviando}
          textoCargando="Guardando…"
          disabled={sinCambios || horarioConError}
        >
          {modo === 'crear' ? 'Crear usuario' : 'Guardar cambios'}
        </Boton>
      }
    >
      {modo === 'editar' && usuarioGuardado ? (
        <div className="etiquetas">
          {!usuarioGuardado.activo ? (
            <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado>
          ) : null}
          {usuarioGuardado.contrasenaTemporal ? (
            <EtiquetaDeEstado tono="alerta">Aún no cambia su contraseña temporal</EtiquetaDeEstado>
          ) : null}
        </div>
      ) : null}

      {guardado ? (
        <Aviso tipo="ok" titulo="Cambios guardados">
          Los cambios de horario y de accesos rigen desde el próximo ingreso de la persona.
        </Aviso>
      ) : null}
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos guardar">
          {fallo}
        </Aviso>
      ) : null}

      <form id="formulario-usuario" className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto
          etiqueta="Nombre"
          value={estado.nombre}
          onChange={(e) => cambiar({ nombre: e.target.value })}
          error={errores.nombre}
          autoComplete="off"
          enterKeyHint="next"
        />

        {modo === 'crear' ? (
          <>
            <CampoTexto
              etiqueta="Nombre de usuario"
              value={estado.nombreUsuario}
              onChange={(e) => cambiar({ nombreUsuario: e.target.value })}
              error={errores.nombreUsuario}
              ayuda="Con este usuario ingresará. No se puede cambiar después."
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="formulario__grupo">
              <CampoTexto
                etiqueta="Contraseña temporal"
                value={estado.contrasenaTemporal}
                onChange={(e) => cambiar({ contrasenaTemporal: e.target.value })}
                error={errores.contrasenaTemporal}
                ayuda="La cambiará al ingresar por primera vez. Compártela en persona."
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Boton
                icono={IconoAzar}
                onClick={() => cambiar({ contrasenaTemporal: generarContrasenaTemporal() })}
              >
                Generar una contraseña
              </Boton>
            </div>
          </>
        ) : (
          <div>
            <span className="texto-ayuda">Nombre de usuario</span>
            <p>
              <b>{estado.nombreUsuario}</b>
            </p>
          </div>
        )}

        <Interruptor
          etiqueta="Es administrador"
          ayuda="Entra a todas las sucursales, maneja usuarios y no tiene horario."
          marcado={estado.esAdministrador}
          onCambio={(esAdministrador) => cambiar({ esAdministrador })}
        />

        {estado.esAdministrador ? null : (
          <>
            <section className="ui-bloque" aria-labelledby="titulo-accesos">
              <h2 className="formulario__titulo" id="titulo-accesos">
                Rol en cada sucursal
              </h2>
              {sesion.sucursales.map((s) => (
                <CampoSeleccion
                  key={s.id}
                  etiqueta={s.nombre}
                  value={estado.accesos[s.id] ?? ''}
                  onChange={(e) =>
                    cambiar({
                      accesos: {
                        ...estado.accesos,
                        [s.id]: e.target.value as EstadoDelFormulario['accesos'][string],
                      },
                    })
                  }
                >
                  <option value="">Sin acceso</option>
                  {ROLES_ASIGNABLES.map((rol) => (
                    <option key={rol} value={rol}>
                      {etiquetaDeRol(rol)}
                    </option>
                  ))}
                </CampoSeleccion>
              ))}
              {errores.accesos ? (
                <p className="ui-campo__mensaje" role="alert">
                  {errores.accesos}
                </p>
              ) : null}
            </section>

            <div className="ui-bloque">
              <Interruptor
                etiqueta="Limitar horario de acceso"
                icono={<Icono icono={IconoReloj} />}
                ayuda="Fuera de este horario no podrá ingresar ni autorizar. Hora de Lima. Si un tramo termina después de medianoche, sigue en el día siguiente."
                marcado={estado.limitarHorario}
                onCambio={(limitarHorario) => cambiar({ limitarHorario })}
              />
              {estado.limitarHorario ? (
                <>
                  <EditorDeHorario
                    valor={estado.horario}
                    onCambio={(horario) => cambiar({ horario })}
                  />
                  {errores.horario ? (
                    <p className="ui-campo__mensaje" role="alert">
                      {errores.horario}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </>
        )}

        <Aviso tipo="info">
          {modo === 'crear'
            ? `Su PIN tendrá ${largo} dígitos. Lo verás una sola vez al crear el usuario.`
            : `Su PIN tiene ${usuarioGuardado?.largoPin ?? largo} dígitos.${
                largo !== (usuarioGuardado?.largoPin ?? largo)
                  ? ` Con estos cambios pasará a ${largo}: se creará uno nuevo y lo verás una sola vez.`
                  : ''
              }`}
        </Aviso>
      </form>

      {modo === 'editar' && usuarioGuardado ? (
        <AccionesDeUsuario
          usuario={usuarioGuardado}
          esUnoMismo={sesion.usuario?.id === usuarioGuardado.id}
          onPinNuevo={(pin) =>
            setVista({
              tipo: 'pin',
              titulo: 'PIN nuevo',
              pin,
              aviso: {
                titulo: `Nuevo PIN para ${usuarioGuardado.nombre}`,
                texto: 'El anterior dejó de funcionar y se cerraron sus sesiones con PIN.',
              },
            })
          }
          onCambio={(usuario) => {
            clientes.setQueryData([...CLAVE_USUARIOS, usuario.id], usuario);
            void clientes.invalidateQueries({ queryKey: CLAVE_USUARIOS });
            setUsuarioGuardado(usuario);
            setEstado(formularioDeUsuario(usuario));
            setGuardado(false);
          }}
        />
      ) : null}
    </Pagina>
  );
}
