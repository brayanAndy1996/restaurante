import { cambiarContrasenaEntradaSchema } from '@restaurante/contratos';
import { Aviso, Boton, CampoContrasena, Cenefa, IconoCandado } from '@restaurante/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ErrorApi, erroresPorCampo, mensajeDeError } from '../../lib/errores';
import { relojDeCuenta } from '../../lib/formato';
import { destinoTrasIngreso, useSesionActiva, useSesion } from './sesion';

interface Errores {
  actual?: string;
  nueva?: string;
  repetir?: string;
}

const MINIMO = 8;

/**
 * Cambio de contraseña. Es obligatorio cuando la contraseña es temporal (criterio 15): hasta que se
 * cambie, la API rechaza todo lo demás. También sirve para cambiarla por gusto, con la actual.
 */
export function CambiarContrasenaPagina() {
  const sesion = useSesionActiva();
  const { releer, salir } = useSesion();
  const navegar = useNavigate();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(false);
  const obligatorio = sesion.debeCambiarContrasena;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (cargando) return;
    const nuevos: Errores = {};
    if (actual === '')
      nuevos.actual = obligatorio
        ? 'Escribe la contraseña temporal'
        : 'Escribe tu contraseña actual';
    if (Array.from(nueva).length < MINIMO)
      nuevos.nueva = `Escribe una contraseña de al menos ${MINIMO} caracteres`;
    else if (nueva === actual) nuevos.nueva = 'La contraseña nueva debe ser distinta de la actual';
    else if (!cambiarContrasenaEntradaSchema.safeParse({ actual, nueva }).success) {
      nuevos.nueva = 'Esa contraseña no es válida. Usa entre 8 y 128 caracteres.';
    }
    if (nuevos.nueva === undefined && repetir !== nueva)
      nuevos.repetir = 'Las dos contraseñas no coinciden';
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    setCargando(true);
    setFallo(null);
    try {
      await api.put('/sesion/contrasena', { actual, nueva });
      const nuevaSesion = await releer();
      navegar(nuevaSesion ? destinoTrasIngreso(nuevaSesion) : '/', { replace: true });
    } catch (error) {
      const e =
        error instanceof ErrorApi
          ? error
          : new ErrorApi({ estado: 0, codigo: 'SIN_CONEXION', mensaje: '' });
      if (e.codigo === 'CREDENCIALES_INVALIDAS') {
        setErrores({ actual: 'La contraseña actual no es correcta' });
        setActual('');
      } else if (e.codigo === 'DATOS_INVALIDOS') {
        const campos = erroresPorCampo(e);
        setErrores({ nueva: campos.nueva ?? 'Revisa la contraseña nueva' });
      } else {
        setFallo(e);
      }
    } finally {
      setCargando(false);
    }
  }

  const segundos = fallo?.codigo === 'BLOQUEO_TEMPORAL' ? fallo.reintentarEnSegundos : undefined;

  return (
    <div className="entrada">
      <Cenefa estado="normal" />
      <div className="entrada__marca">Restaurante</div>
      <div className="entrada__cuerpo">
        <div>
          <h1 className="ui-titulo">
            {obligatorio ? 'Elige tu contraseña' : 'Cambia tu contraseña'}
          </h1>
          <p className="ui-subtitulo">
            {obligatorio
              ? 'Tu contraseña es temporal. Elige una nueva para seguir.'
              : 'Escribe la actual y la nueva. Se cerrarán tus otras sesiones.'}
          </p>
        </div>

        {fallo ? (
          <Aviso
            tipo="error"
            {...(fallo.codigo === 'BLOQUEO_TEMPORAL' ? { icono: IconoCandado } : {})}
            titulo={
              fallo.codigo === 'BLOQUEO_TEMPORAL'
                ? 'Cambio bloqueado por unos minutos'
                : 'No pudimos cambiarla'
            }
          >
            {segundos === undefined
              ? mensajeDeError(fallo)
              : `Hiciste demasiados intentos. Vuelve a probar en ${relojDeCuenta(segundos)}.`}
          </Aviso>
        ) : null}

        <form className="formulario" onSubmit={enviar} noValidate>
          <CampoContrasena
            etiqueta={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'}
            name="actual"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            error={errores.actual}
            autoComplete="current-password"
          />
          <CampoContrasena
            etiqueta="Contraseña nueva"
            name="nueva"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            error={errores.nueva}
            ayuda="Mínimo 8 caracteres."
            autoComplete="new-password"
          />
          <CampoContrasena
            etiqueta="Repite la contraseña nueva"
            name="repetir"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            error={errores.repetir}
            autoComplete="new-password"
          />
          <Boton
            type="submit"
            variante="principal"
            bloque
            cargando={cargando}
            textoCargando="Guardando…"
            disabled={fallo?.codigo === 'BLOQUEO_TEMPORAL'}
          >
            Guardar contraseña
          </Boton>
        </form>

        <div className="entrada__pie">
          {obligatorio ? (
            <Boton variante="texto" onClick={() => void salir()}>
              Salir
            </Boton>
          ) : (
            <Boton variante="texto" onClick={() => navegar(-1)}>
              Cancelar
            </Boton>
          )}
        </div>
      </div>
    </div>
  );
}
