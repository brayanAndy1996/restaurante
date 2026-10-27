import { ingresoSuperadministradorRespuestaSchema } from '@restaurante/contratos';
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
import { useSesion, type EstadoDeIngreso } from '../acceso/sesion';

/** Ingreso propio del superadministrador (criterio 101): su sesión dura 8 horas y es independiente de las empresas. */
export function PlataformaIngresoPagina() {
  const { plataforma, ingresarPlataforma } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const estado = (ubicacion.state ?? {}) as EstadoDeIngreso;
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [errores, setErrores] = useState<{ usuario?: string; contrasena?: string }>({});
  const [fallo, setFallo] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(false);
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(null);
  const [faltan, setFaltan] = useState(0);

  useEffect(() => {
    if (bloqueadoHasta === null) return;
    const medir = () => {
      const s = Math.max(0, Math.ceil((bloqueadoHasta - Date.now()) / 1000));
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

  if (plataforma) return <Navigate to="/plataforma" replace />;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (cargando || bloqueadoHasta !== null) return;
    const nuevos: typeof errores = {};
    if (usuario.trim() === '') nuevos.usuario = 'Escribe tu usuario';
    if (contrasena === '') nuevos.contrasena = 'Escribe tu contraseña';
    setErrores(nuevos);
    if (nuevos.usuario || nuevos.contrasena) return;

    setCargando(true);
    setFallo(null);
    try {
      const respuesta = await api.post(
        '/plataforma/sesiones',
        { usuario: usuario.trim(), contrasena },
        {
          esquema: ingresoSuperadministradorRespuestaSchema,
          ambito: 'plataforma',
          sinToken: true,
          reintentos: 2,
        },
      );
      ingresarPlataforma(respuesta);
      navegar('/plataforma', { replace: true });
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

  const bloqueado = bloqueadoHasta !== null;
  return (
    <div className="entrada">
      <Cenefa estado="plataforma" />
      <div className="entrada__marca entrada__marca--plataforma">Plataforma</div>
      <div className="entrada__cuerpo">
        <div>
          <h1 className="ui-titulo">Ingreso de plataforma</h1>
          <p className="ui-subtitulo">Solo para el equipo que administra a los clientes.</p>
        </div>

        {estado.aviso && !fallo ? (
          <Aviso tipo="info" titulo="Tu sesión se cerró">
            {estado.aviso === 'revocada' ? 'Ya no es válida.' : 'Por inactividad.'} Ingresa de nuevo
            para continuar.
          </Aviso>
        ) : null}

        {bloqueado ? (
          <Aviso tipo="error" icono={IconoCandado} titulo="Ingreso bloqueado por unos minutos">
            Hiciste demasiados intentos. Podrás volver a intentar cuando termine la cuenta.
            <span
              className="cuenta-regresiva"
              role="timer"
              aria-label={`Faltan ${relojDeCuenta(faltan)}`}
            >
              {relojDeCuenta(faltan)}
            </span>
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
          />
          <CampoContrasena
            etiqueta="Contraseña"
            name="contrasena"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            error={errores.contrasena}
            autoComplete="current-password"
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
          <p className="texto-ayuda">¿Trabajas en un restaurante?</p>
          <Link to="/ingreso" className={claseBoton('texto')}>
            Ingresar al restaurante
          </Link>
        </div>
      </div>
    </div>
  );
}
