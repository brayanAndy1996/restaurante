import type { UsuarioRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoTexto,
  DialogoConfirmacion,
  Hoja,
  IconoAzar,
  IconoDesactivar,
  IconoLlave,
  IconoReactivar,
} from '@restaurante/ui';
import { useState } from 'react';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import {
  generarContrasenaTemporal,
  modificarUsuario,
  regenerarPin,
  restablecerContrasena,
} from './usuarios';

const MENSAJES = {
  ULTIMO_ADMINISTRADOR:
    'La empresa no puede quedarse sin un administrador activo. Nombra a otro antes de desactivar a esta persona.',
} as const;

function comoErrorApi(e: unknown): ErrorApi {
  return e instanceof ErrorApi
    ? e
    : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
}

interface Props {
  usuario: UsuarioRespuesta;
  /** Es la propia persona que administra: no puede desactivarse a sí misma. */
  esUnoMismo: boolean;
  /** Muestra el PIN nuevo (una sola vez). */
  onPinNuevo: (pin: string) => void;
  /** El usuario cambió (desactivado o reactivado). */
  onCambio: (usuario: UsuarioRespuesta) => void;
}

/**
 * Acciones que cierran sesiones o dejan rastro: viven aparte de "Guardar", separadas por 24 px y una
 * junta, y cada una pide confirmación que dice qué pasará (nunca es la acción por defecto).
 */
export function AccionesDeUsuario({ usuario, esUnoMismo, onPinNuevo, onCambio }: Props) {
  const [abierta, setAbierta] = useState<'pin' | 'contrasena' | 'estado' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restablecer contraseña
  const [temporal, setTemporal] = useState('');
  const [errorTemporal, setErrorTemporal] = useState<string | undefined>();
  const [contrasenaListo, setContrasenaListo] = useState<string | null>(null);

  function cerrar() {
    setAbierta(null);
    setError(null);
    setErrorTemporal(undefined);
    setTemporal('');
    setContrasenaListo(null);
  }

  async function confirmarPin() {
    setCargando(true);
    setError(null);
    try {
      const { pin } = await regenerarPin(usuario.id);
      cerrar();
      onPinNuevo(pin);
    } catch (e) {
      setError(mensajeDeError(comoErrorApi(e)));
    } finally {
      setCargando(false);
    }
  }

  async function confirmarEstado() {
    setCargando(true);
    setError(null);
    try {
      const actualizado = await modificarUsuario(usuario.id, { activo: !usuario.activo });
      cerrar();
      const { pin: _pin, ...sinPin } = actualizado;
      onCambio(sinPin);
    } catch (e) {
      setError(mensajeDeError(comoErrorApi(e), MENSAJES));
    } finally {
      setCargando(false);
    }
  }

  async function confirmarContrasena() {
    const largo = Array.from(temporal).length;
    if (largo < 8) {
      setErrorTemporal(
        largo === 0 ? 'Escribe una contraseña temporal o genera una' : 'Usa al menos 8 caracteres',
      );
      return;
    }
    setCargando(true);
    setError(null);
    try {
      await restablecerContrasena(usuario.id, temporal);
      setContrasenaListo(temporal);
    } catch (e) {
      setError(mensajeDeError(comoErrorApi(e)));
    } finally {
      setCargando(false);
    }
  }

  const aviso = error ? (
    <Aviso tipo="error" titulo="No pudimos hacerlo">
      {error}
    </Aviso>
  ) : null;

  return (
    <section className="formulario__aparte" aria-label="Acciones sobre este usuario">
      <h2 className="formulario__titulo">Acciones</h2>
      <Boton bloque icono={IconoLlave} onClick={() => setAbierta('pin')}>
        Regenerar PIN
      </Boton>
      <Boton bloque icono={IconoLlave} onClick={() => setAbierta('contrasena')}>
        Restablecer contraseña
      </Boton>
      {usuario.activo ? (
        esUnoMismo ? null : (
          <Boton
            bloque
            variante="peligro"
            icono={IconoDesactivar}
            onClick={() => setAbierta('estado')}
          >
            Desactivar usuario
          </Boton>
        )
      ) : (
        <Boton bloque icono={IconoReactivar} onClick={() => setAbierta('estado')}>
          Reactivar usuario
        </Boton>
      )}

      <DialogoConfirmacion
        abierta={abierta === 'pin'}
        titulo="Regenerar el PIN"
        etiquetaConfirmar="Generar PIN nuevo"
        cargando={cargando}
        textoCargando="Generando…"
        error={aviso}
        onConfirmar={() => void confirmarPin()}
        onCancelar={cerrar}
      >
        {`Se creará un PIN nuevo de ${usuario.largoPin} dígitos para ${usuario.nombre}. El anterior dejará de funcionar y se cerrarán sus sesiones con PIN. Lo verás una sola vez.`}
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierta={abierta === 'estado'}
        titulo={usuario.activo ? `Desactivar a ${usuario.nombre}` : `Reactivar a ${usuario.nombre}`}
        etiquetaConfirmar={usuario.activo ? 'Desactivar' : 'Reactivar'}
        peligro={usuario.activo}
        cargando={cargando}
        textoCargando={usuario.activo ? 'Desactivando…' : 'Reactivando…'}
        error={aviso}
        onConfirmar={() => void confirmarEstado()}
        onCancelar={cerrar}
      >
        {usuario.activo
          ? 'No podrá ingresar. Se cerrarán sus sesiones abiertas y se olvidarán los celulares que recuerda. Sus datos y su historial se conservan.'
          : 'Podrá volver a ingresar con su contraseña. Los celulares que recordaba no se recuperan: tendrá que ingresar con contraseña en cada uno.'}
      </DialogoConfirmacion>

      <Hoja abierta={abierta === 'contrasena'} onCerrar={cerrar} titulo="Restablecer la contraseña">
        {contrasenaListo ? (
          <>
            <Aviso tipo="ok" titulo="Contraseña restablecida">
              Se cerraron las sesiones de {usuario.nombre} y se olvidaron sus celulares. Entrégale
              esta contraseña temporal: la cambiará al ingresar.
            </Aviso>
            <div className="ui-bloque">
              <span className="texto-ayuda">Contraseña temporal</span>
              <b style={{ fontSize: '1.25rem', overflowWrap: 'anywhere', userSelect: 'all' }}>
                {contrasenaListo}
              </b>
            </div>
            <Boton variante="principal" bloque onClick={cerrar}>
              Listo
            </Boton>
          </>
        ) : (
          <>
            <p>
              {`${usuario.nombre} tendrá que ingresar con esta contraseña temporal y cambiarla. Se cerrarán sus sesiones y se olvidarán los celulares que recuerda.`}
            </p>
            <CampoTexto
              etiqueta="Contraseña temporal"
              value={temporal}
              onChange={(e) => {
                setTemporal(e.target.value);
                setErrorTemporal(undefined);
              }}
              error={errorTemporal}
              ayuda="Al menos 8 caracteres. Compártela en persona."
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Boton
              icono={IconoAzar}
              bloque
              onClick={() => setTemporal(generarContrasenaTemporal())}
            >
              Generar una
            </Boton>
            {aviso}
            <Boton
              variante="principal"
              bloque
              cargando={cargando}
              textoCargando="Restableciendo…"
              onClick={() => void confirmarContrasena()}
            >
              Restablecer contraseña
            </Boton>
            <Boton bloque onClick={cerrar} disabled={cargando}>
              Cancelar
            </Boton>
          </>
        )}
      </Hoja>
    </section>
  );
}
