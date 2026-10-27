import { ingresoRespuestaSchema } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoContrasena,
  CampoTexto,
  Cenefa,
  IconoCandado,
  claseBoton,
} from '@restaurante/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { relojDeCuenta } from '../../lib/formato';
import { destinoTrasIngreso, useSesion, type EstadoDeIngreso, type MotivoDeCierre } from './sesion';

const AVISOS_DE_CIERRE: Record<MotivoDeCierre, { titulo: string; texto: string }> = {
  inactividad: {
    titulo: 'Tu sesión se cerró por inactividad',
    texto: 'Ingresa de nuevo para continuar.',
  },
  expirada: {
    titulo: 'Tu sesión se cerró por inactividad',
    texto: 'Ingresa de nuevo para continuar.',
  },
  revocada: {
    titulo: 'Tu sesión ya no es válida',
    texto: 'Alguien la cerró o cambió tus permisos. Ingresa de nuevo.',
  },
};

/** Segundos que faltan hasta `hasta` (ms); 0 si ya pasó. */
function segundosHasta(hasta: number): number {
  return Math.max(0, Math.ceil((hasta - Date.now()) / 1000));
}

interface Errores {
  usuario?: string;
  contrasena?: string;
}

/** Ingreso con usuario y contraseña (criterio 93): errores de credenciales, de bloqueo y de horario. */
export function IngresoPagina() {
  const { sesion, ingresar } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const estado = (ubicacion.state ?? {}) as EstadoDeIngreso & { desde?: string };
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(false);
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(null);
  const [faltan, setFaltan] = useState(0);

  // Cuenta regresiva del bloqueo: al llegar a cero se puede volver a intentar.
  useEffect(() => {
    if (bloqueadoHasta === null) return;
    const medir = () => {
      const s = segundosHasta(bloqueadoHasta);
      setFaltan(s);
      if (s <= 0) {
        setBloqueadoHasta(null);
        setFallo(null);
      }
    };
    medir();
    const reloj = setInterval(medir, 1000);
    return () => clearInterval(reloj);
  }, [bloqueadoHasta]);

  if (sesion) return <Navigate to={destinoTrasIngreso(sesion)} replace />;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (cargando || bloqueadoHasta !== null) return;
    const nuevos: Errores = {};
    if (usuario.trim() === '') nuevos.usuario = 'Escribe tu usuario';
    if (contrasena === '') nuevos.contrasena = 'Escribe tu contraseña';
    setErrores(nuevos);
    if (nuevos.usuario || nuevos.contrasena) return;

    setCargando(true);
    setFallo(null);
    try {
      const respuesta = await api.post(
        '/sesiones/contrasena',
        { usuario: usuario.trim(), contrasena },
        { esquema: ingresoRespuestaSchema, sinToken: true, reintentos: 2 },
      );
      ingresar(respuesta);
      const destino = destinoTrasIngreso(respuesta.sesion);
      navegar(destino === '/' && estado.desde ? estado.desde : destino, { replace: true });
    } catch (error) {
      const e =
        error instanceof ErrorApi
          ? error
          : new ErrorApi({ estado: 0, codigo: 'SIN_CONEXION', mensaje: '' });
      setFallo(e);
      if (e.codigo === 'BLOQUEO_TEMPORAL' && e.reintentarEnSegundos !== undefined) {
        setBloqueadoHasta(Date.now() + e.reintentarEnSegundos * 1000);
      }
      if (e.codigo === 'CREDENCIALES_INVALIDAS') setContrasena('');
    } finally {
      setCargando(false);
    }
  }

  const cierre = estado.aviso ? AVISOS_DE_CIERRE[estado.aviso] : null;
  const bloqueado = bloqueadoHasta !== null;

  return (
    <div className="entrada">
      <Cenefa estado="normal" />
      <div className="entrada__marca">
        <img src="/icono.svg" alt="" width={32} height={32} />
        Restaurante
      </div>
      <div className="entrada__cuerpo">
        <div>
          <h1 className="ui-titulo">Ingresa</h1>
          <p className="ui-subtitulo">Con tu usuario y tu contraseña.</p>
        </div>

        {cierre && !fallo ? (
          <Aviso tipo="info" titulo={cierre.titulo}>
            {cierre.texto}
          </Aviso>
        ) : null}

        {bloqueado ? (
          <Aviso tipo="error" icono={IconoCandado} titulo="Ingreso bloqueado por unos minutos">
            Hiciste demasiados intentos. Por seguridad, podrás volver a intentar cuando termine la
            cuenta.
            <span
              className="cuenta-regresiva"
              role="timer"
              aria-label={`Faltan ${relojDeCuenta(faltan)}`}
            >
              {relojDeCuenta(faltan)}
            </span>
          </Aviso>
        ) : fallo?.codigo === 'FUERA_DE_HORARIO' ? (
          <Aviso tipo="alerta" titulo="Estás fuera de tu horario de acceso">
            Ahora no puedes ingresar. Pide a tu administrador que revise tu horario.
          </Aviso>
        ) : fallo ? (
          <Aviso
            tipo="error"
            titulo={fallo.sinConexion ? 'No hay conexión' : 'No pudimos ingresarte'}
          >
            {mensajeDeError(fallo)}
          </Aviso>
        ) : null}

        <form className="formulario" onSubmit={enviar} noValidate>
          <CampoTexto
            etiqueta="Usuario"
            name="usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            error={errores.usuario}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
          />
          <CampoContrasena
            etiqueta="Contraseña"
            name="contrasena"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            error={errores.contrasena}
            autoComplete="current-password"
            enterKeyHint="go"
          />
          <Boton
            type="submit"
            variante="principal"
            bloque
            cargando={cargando}
            textoCargando="Ingresando…"
            disabled={bloqueado}
          >
            Ingresar
          </Boton>
        </form>

        <div className="entrada__pie">
          <p className="texto-ayuda">¿Eres del equipo de la plataforma?</p>
          <Link to="/plataforma/ingreso" className={claseBoton('texto')}>
            Ingresar a la plataforma
          </Link>
        </div>
      </div>
    </div>
  );
}
