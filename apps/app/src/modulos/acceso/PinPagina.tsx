import { ingresoRespuestaSchema } from '@restaurante/contratos';
import { MAXIMO_PERSONAS_POR_EQUIPO } from '@restaurante/dominio';
import {
  Aviso,
  BaldosaPersona,
  Boton,
  Cenefa,
  CuposDelEquipo,
  IconoCandado,
  IconoReintentar,
  Inicial,
  PuntosPin,
  TecladoNumerico,
  claseBoton,
  type EstadoPuntos,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PantallaDeCarga } from '../../componentes/Pantallas';
import { borrarTokenDeEquipo } from '../../lib/almacen';
import { ahoraDelServidor, api } from '../../lib/api';
import {
  CLAVE_EQUIPOS,
  consultarEquiposRecordados,
  type EquiposRecordados,
  type PersonaDelEquipo,
} from '../../lib/equipo';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { relojDeCuenta } from '../../lib/formato';
import { useSegundosHasta } from '../../lib/tiempo';
import { destinoTrasIngreso, useSesion, type EstadoDeIngreso, type MotivoDeCierre } from './sesion';

/** Cuánto se ve el error en los puntos antes de vaciarlos para el siguiente intento. */
const MS_DE_ERROR_EN_PUNTOS = 600;

const AVISOS_DE_CIERRE: Record<MotivoDeCierre, { titulo: string; texto: string }> = {
  inactividad: {
    titulo: 'Tu sesión se cerró por inactividad',
    texto: 'Escribe tu PIN para continuar.',
  },
  expirada: {
    titulo: 'Tu sesión se cerró por inactividad',
    texto: 'Escribe tu PIN para continuar.',
  },
  revocada: {
    titulo: 'Tu sesión ya no es válida',
    texto: 'Alguien la cerró o cambió tus permisos. Ingresa de nuevo.',
  },
};

function claveDe(p: PersonaDelEquipo): string {
  return `${p.empresaId}:${p.usuarioId}`;
}

/** Fila de la lista de personas: con la cuenta regresiva viva si su PIN está bloqueado. */
function PersonaElegible({
  persona,
  onElegir,
}: {
  persona: PersonaDelEquipo;
  onElegir: () => void;
}) {
  const faltan = useSegundosHasta(persona.bloqueadoHastaEn);
  const bloqueada = faltan > 0;
  return (
    <BaldosaPersona
      nombre={persona.nombre}
      detalle={
        bloqueada
          ? `Bloqueado: vuelve en ${relojDeCuenta(faltan)}`
          : `PIN de ${persona.largoPin} dígitos`
      }
      bloqueada={bloqueada}
      onElegir={onElegir}
    />
  );
}

interface PropsEntrada {
  persona: PersonaDelEquipo;
  /** Hay otras personas entre las que cambiar. */
  hayOtras: boolean;
  onCambiarDePersona: () => void;
  /** Vuelve a leer qué personas recuerda el equipo (después de un PIN equivocado). */
  onActualizar: () => Promise<EquiposRecordados | undefined>;
  aviso: { titulo: string; texto: string } | null;
}

/** Teclado y puntos para una persona: el PIN solo vive en este estado, nunca se muestra ni se guarda. */
function EntradaDePin({
  persona,
  hayOtras,
  onCambiarDePersona,
  onActualizar,
  aviso,
}: PropsEntrada) {
  const { ingresar } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const desde = (ubicacion.state as { desde?: string } | null)?.desde;
  const largo = persona.largoPin;
  const [pin, setPin] = useState('');
  const pinActual = useRef('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<ErrorApi | null>(null);
  const [equivocados, setEquivocados] = useState(0);
  const [puntosEnError, setPuntosEnError] = useState(false);
  // Por qué este equipo ya no deja entrar a la persona: demasiados intentos, o el servidor ya no lo reconoce.
  const [olvido, setOlvido] = useState<'intentos' | 'equipo' | null>(null);
  const olvidada = olvido !== null;
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(
    persona.bloqueadoHastaEn ? Date.parse(persona.bloqueadoHastaEn) : null,
  );
  const faltan = useSegundosHasta(bloqueadoHasta);
  const bloqueado = faltan > 0;
  const poner = useCallback((valor: string) => {
    pinActual.current = valor;
    setPin(valor);
  }, []);

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Al terminar la cuenta regresiva se puede volver a intentar.
  useEffect(() => {
    if (bloqueadoHasta !== null && faltan === 0) {
      setBloqueadoHasta(null);
      setFallo(null);
    }
  }, [bloqueadoHasta, faltan]);

  // El error se ve un instante en los puntos y luego se vacían para el siguiente intento.
  useEffect(() => {
    if (!puntosEnError) return;
    const temporizador = setTimeout(() => {
      setPuntosEnError(false);
      poner('');
    }, MS_DE_ERROR_EN_PUNTOS);
    return () => clearTimeout(temporizador);
  }, [puntosEnError, poner]);

  const enviar = useCallback(
    async (completo: string) => {
      setEnviando(true);
      setFallo(null);
      try {
        const respuesta = await api.post(
          '/sesiones/pin',
          { usuarioId: persona.usuarioId, pin: completo },
          {
            esquema: ingresoRespuestaSchema,
            sinToken: true,
            equipo: persona.tokenEquipo,
            reintentos: 2,
          },
        );
        ingresar(respuesta, persona.tokenEquipo);
        const destino = destinoTrasIngreso(respuesta.sesion);
        navegar(destino === '/' && desde ? desde : destino, { replace: true });
      } catch (error) {
        const e =
          error instanceof ErrorApi
            ? error
            : new ErrorApi({ estado: 0, codigo: 'SIN_CONEXION', mensaje: '' });
        if (!montado.current) return;
        setFallo(e);
        if (e.codigo === 'BLOQUEO_TEMPORAL') {
          setBloqueadoHasta(ahoraDelServidor() + (e.reintentarEnSegundos ?? 300) * 1000);
          poner('');
        } else if (e.codigo === 'EQUIPO_NO_RECONOCIDO') {
          // Este equipo ya no existe para el servidor: se olvida su token y se pasa a la contraseña.
          borrarTokenDeEquipo(persona.empresaId);
          setOlvido('equipo');
          poner('');
          void onActualizar();
        } else if (e.codigo === 'CREDENCIALES_INVALIDAS') {
          setEquivocados((n) => n + 1);
          setPuntosEnError(true);
          // Tras un PIN equivocado el servidor pudo bloquear a la persona (5.º y 10.º fallo) o dejar de
          // recordarla (15.º): se pregunta para decirlo ya, sin gastar otro intento.
          const resultado = await onActualizar();
          if (!montado.current) return;
          const sigue = resultado?.personas.find(
            (p) => p.usuarioId === persona.usuarioId && p.empresaId === persona.empresaId,
          );
          if (resultado && !resultado.fallo && !sigue) {
            setOlvido('intentos');
            poner('');
            setPuntosEnError(false);
          } else if (sigue?.bloqueadoHastaEn) {
            setBloqueadoHasta(Date.parse(sigue.bloqueadoHastaEn));
            poner('');
            setPuntosEnError(false);
          }
        } else {
          poner('');
        }
      } finally {
        if (montado.current) setEnviando(false);
      }
    },
    [desde, ingresar, navegar, onActualizar, persona, poner],
  );

  const ocupado = enviando || bloqueado || olvidada;

  const alDigito = useCallback(
    (digito: string) => {
      if (ocupado) return;
      // Si todavía se ve el error de los puntos, el nuevo dígito empieza otro intento.
      const base = puntosEnError ? '' : pinActual.current;
      if (base.length >= largo) return;
      const siguiente = base + digito;
      setPuntosEnError(false);
      setFallo((f) => (f?.codigo === 'CREDENCIALES_INVALIDAS' ? null : f));
      poner(siguiente);
      if (siguiente.length === largo) void enviar(siguiente);
    },
    [enviar, largo, ocupado, poner, puntosEnError],
  );

  const alBorrar = useCallback(() => {
    if (ocupado || puntosEnError) return;
    poner(pinActual.current.slice(0, -1));
  }, [ocupado, poner, puntosEnError]);

  // Con teclado físico (computadora, tablet con teclado) también se puede escribir el PIN.
  useEffect(() => {
    const oyente = (evento: KeyboardEvent) => {
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
      if (/^[0-9]$/.test(evento.key)) alDigito(evento.key);
      else if (evento.key === 'Backspace') alBorrar();
    };
    window.addEventListener('keydown', oyente);
    return () => window.removeEventListener('keydown', oyente);
  }, [alDigito, alBorrar]);

  const estadoPuntos: EstadoPuntos =
    bloqueado || olvidada ? 'apagado' : puntosEnError ? 'error' : 'normal';
  const salidaPrincipal = bloqueado || olvidada;

  return (
    <div className="entrada__cuerpo pin">
      <div>
        <h1 className="ui-titulo">Escribe tu PIN</h1>
      </div>

      <div className="ui-sesion-datos">
        <Inicial nombre={persona.nombre} />
        <div className="ui-sesion-datos__texto">
          <b className="ui-fila__titulo">{persona.nombre}</b>
          <span className="ui-fila__ayuda">{`PIN de ${largo} dígitos`}</span>
        </div>
      </div>

      <div className="pin__zona">
        <PuntosPin largo={largo} llenos={pin.length} estado={estadoPuntos} />
        <div className="pin__mensaje">
          {olvido === 'intentos' ? (
            <Aviso tipo="error" icono={IconoCandado} titulo="Este equipo ya no te recuerda">
              Hubo demasiados intentos con un PIN equivocado. Ingresa con tu usuario y contraseña.
            </Aviso>
          ) : olvido === 'equipo' ? (
            <Aviso tipo="error" titulo="Este equipo ya no está registrado">
              Ingresa con tu usuario y contraseña; después podrás volver a entrar con PIN.
            </Aviso>
          ) : bloqueado ? (
            <Aviso tipo="error" icono={IconoCandado} titulo="PIN bloqueado por unos minutos">
              Hiciste demasiados intentos en este equipo. Podrás volver a intentar cuando termine la
              cuenta.
              <span
                className="cuenta-regresiva"
                role="timer"
                aria-label={`Faltan ${relojDeCuenta(faltan)}`}
              >
                {relojDeCuenta(faltan)}
              </span>
            </Aviso>
          ) : fallo?.codigo === 'CREDENCIALES_INVALIDAS' ? (
            <Aviso tipo="error" titulo="El PIN no es correcto">
              {equivocados >= 2
                ? 'Si no lo recuerdas, ingresa con tu usuario y contraseña.'
                : 'Revisa y vuelve a intentar.'}
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
          ) : aviso ? (
            <Aviso tipo="info" titulo={aviso.titulo}>
              {aviso.texto}
            </Aviso>
          ) : null}
        </div>
      </div>

      <TecladoNumerico onDigito={alDigito} onBorrar={alBorrar} deshabilitado={ocupado} />

      <div className="pin__salidas">
        {hayOtras ? (
          <Boton variante="texto" bloque onClick={onCambiarDePersona}>
            Cambiar de persona
          </Boton>
        ) : null}
        <Link
          to="/ingreso"
          state={{ desde }}
          className={claseBoton(salidaPrincipal ? 'principal' : 'texto', true)}
        >
          Ingresar con usuario y contraseña
        </Link>
      </div>
    </div>
  );
}

/**
 * Pantalla de PIN (criterios 92 y 94). Al abrir la PWA sin sesión pregunta a la API qué personas recuerda
 * cada token de equipo guardado: con una o varias, se entra con PIN; sin ninguna, se pasa al ingreso con
 * usuario y contraseña. Con varias personas se elige primero el nombre; con una, se va directo al teclado.
 */
export function PinPagina() {
  const { sesion } = useSesion();
  const ubicacion = useLocation();
  const estado = (ubicacion.state ?? {}) as EstadoDeIngreso & { desde?: string };
  const consulta = useQuery({
    queryKey: CLAVE_EQUIPOS,
    queryFn: ({ signal }) => consultarEquiposRecordados(signal),
    enabled: !sesion,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  // La persona con el teclado abierto se guarda aparte de la lista: si el equipo deja de recordarla (15.º
  // fallo), la pantalla debe seguir diciéndolo en vez de desaparecer con ella.
  const [activa, setActiva] = useState<PersonaDelEquipo | null>(null);
  const { refetch } = consulta;
  const actualizar = useCallback(async () => (await refetch()).data, [refetch]);

  if (sesion) return <Navigate to={destinoTrasIngreso(sesion)} replace />;

  const datos = consulta.data;
  const personas = datos?.personas ?? [];
  const unica = personas.length === 1 ? personas[0] : undefined;
  if (!activa && unica) setActiva(unica);
  const cierre = estado.aviso ? AVISOS_DE_CIERRE[estado.aviso] : null;

  const marco = (hijos: ReactNode) => (
    <div className="entrada">
      <Cenefa estado="normal" />
      <div className="entrada__marca">
        <img src="/icono.svg" alt="" width={32} height={32} />
        Restaurante
      </div>
      {hijos}
    </div>
  );

  if (consulta.isPending)
    return <PantallaDeCarga etiqueta="Buscando las personas de este equipo" />;

  if (consulta.isError || (datos?.fallo && personas.length === 0)) {
    const error = consulta.error ?? datos?.fallo ?? null;
    return marco(
      <div className="entrada__cuerpo">
        <Aviso tipo="error" titulo="No pudimos abrir el ingreso con PIN">
          {mensajeDeError(error)}
        </Aviso>
        <Boton
          variante="principal"
          bloque
          icono={IconoReintentar}
          cargando={consulta.isFetching}
          textoCargando="Reintentando…"
          onClick={() => void refetch()}
        >
          Reintentar
        </Boton>
        <Link to="/ingreso" state={ubicacion.state} className={claseBoton('secundario', true)}>
          Ingresar con usuario y contraseña
        </Link>
      </div>,
    );
  }

  if (personas.length === 0 && !activa) {
    // Ningún equipo recuerda a nadie: el ingreso con contraseña, con el aviso que traía la navegación.
    return <Navigate to="/ingreso" replace state={ubicacion.state} />;
  }

  if (activa) {
    return marco(
      <EntradaDePin
        key={claveDe(activa)}
        persona={activa}
        hayOtras={personas.some((p) => claveDe(p) !== claveDe(activa))}
        onCambiarDePersona={() => setActiva(null)}
        onActualizar={actualizar}
        aviso={cierre}
      />,
    );
  }

  const unSoloEquipo = (datos?.equipos.length ?? 0) === 1;
  return marco(
    <div className="entrada__cuerpo">
      <div>
        <h1 className="ui-titulo">¿Quién eres?</h1>
        <p className="ui-subtitulo">Toca tu nombre y escribe tu PIN.</p>
      </div>
      {cierre ? (
        <Aviso tipo="info" titulo={cierre.titulo}>
          {cierre.texto}
        </Aviso>
      ) : null}
      <div className="formulario__grupo">
        {personas.map((p) => (
          <PersonaElegible key={claveDe(p)} persona={p} onElegir={() => setActiva(p)} />
        ))}
      </div>
      {unSoloEquipo ? (
        <CuposDelEquipo usados={personas.length} maximo={MAXIMO_PERSONAS_POR_EQUIPO} />
      ) : null}
      <div className="entrada__pie">
        <Link to="/ingreso" state={{ desde: estado.desde }} className={claseBoton('texto', true)}>
          Ingresar con usuario y contraseña
        </Link>
      </div>
    </div>,
  );
}
