import {
  sesionRespuestaSchema,
  type IngresoRespuesta,
  type IngresoSuperadministradorRespuesta,
  type SesionRespuesta,
} from '@restaurante/contratos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  borrarSesionDePlataforma,
  borrarSoporteEnCurso,
  borrarTokenDeSesion,
  guardarSesionDePlataforma,
  guardarSoporteEnCurso,
  guardarTokenDeSesion,
  sesionDePlataforma,
  soporteEnCurso,
  tokenDeSesion,
  type SesionPlataforma,
  type SoporteEnCurso,
} from '../../lib/almacen';
import { api, configurarApi } from '../../lib/api';
import type { ErrorApi } from '../../lib/errores';

/** Por qué se cerró la sesión sin que la persona lo pidiera: se avisa en la pantalla de ingreso. */
export type MotivoDeCierre = 'inactividad' | 'expirada' | 'revocada';

export interface EstadoDeIngreso {
  aviso?: MotivoDeCierre;
}

interface ContextoSesion {
  /** La sesión de empresa (contraseña, PIN o soporte) o `null` si no hay. */
  sesion: SesionRespuesta | null;
  /**
   * A dónde mandan las rutas protegidas cuando la sesión se cierra (con su aviso): el cierre y la
   * redirección ocurren en el mismo renderizado, así que no hay carreras con la navegación.
   */
  salida: Salida | null;
  /** Hay un token y todavía se está leyendo `GET /sesion`. */
  cargando: boolean;
  /** `GET /sesion` falló sin ser un 401 (por ejemplo, sin conexión). */
  errorDeCarga: ErrorApi | null;
  reintentarCarga: () => void;
  hayToken: boolean;
  /** Guarda el token del ingreso y deja la sesión lista, sin otra consulta. */
  ingresar: (respuesta: IngresoRespuesta) => void;
  /** Reemplaza la sesión en caché (después de cambiar de sucursal o de contraseña). */
  actualizarSesion: (sesion: SesionRespuesta) => void;
  /** Vuelve a leer la sesión del servidor. Sin `segundoPlano`, renueva la inactividad. */
  releer: (opciones?: { segundoPlano?: boolean }) => Promise<SesionRespuesta | null>;
  /** Cierra la sesión: avisa a la API sin esperar y borra el token. */
  salir: (motivo?: MotivoDeCierre) => Promise<void>;
  soporte: SoporteEnCurso | null;
  /** Entra a la cuenta de una empresa con la sesión de soporte que abrió el panel. */
  iniciarSoporte: (respuesta: IngresoRespuesta, empresa: { id: string; nombre: string }) => void;
  /** Termina el soporte y vuelve al panel con la sesión del superadministrador intacta. */
  terminarSoporte: () => Promise<void>;
  /** Sesión del superadministrador (panel de plataforma). */
  plataforma: SesionPlataforma | null;
  ingresarPlataforma: (respuesta: IngresoSuperadministradorRespuesta) => void;
  salirDePlataforma: (motivo?: MotivoDeCierre) => Promise<void>;
}

/** Destino de una salida: la ruta y el estado de navegación con el aviso. */
export interface Salida {
  a: string;
  estado: EstadoDeIngreso;
}

const Contexto = createContext<ContextoSesion | null>(null);

export const CLAVE_SESION = ['sesion'] as const;

export function useSesion(): ContextoSesion {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useSesion debe usarse dentro de SesionProvider');
  return contexto;
}

/** Sesión que se sabe que existe: solo dentro de rutas protegidas. */
export function useSesionActiva(): SesionRespuesta {
  const { sesion } = useSesion();
  if (!sesion) throw new Error('useSesionActiva se usó sin una sesión');
  return sesion;
}

export function SesionProvider({ children }: { children: ReactNode }) {
  const clientes = useQueryClient();
  const [hayToken, setHayToken] = useState(() => tokenDeSesion() !== null);
  const [soporte, setSoporte] = useState<SoporteEnCurso | null>(() => soporteEnCurso());
  const [plataforma, setPlataforma] = useState<SesionPlataforma | null>(() => sesionDePlataforma());
  const [salida, setSalida] = useState<Salida | null>(null);
  const { pathname } = useLocation();

  // Cuando la redirección ya llegó a su destino, el aviso vive en el estado de la ubicación.
  useEffect(() => {
    if (salida && pathname === salida.a) setSalida(null);
  }, [pathname, salida]);

  const consulta = useQuery({
    queryKey: CLAVE_SESION,
    enabled: hayToken,
    queryFn: ({ signal }) => api.get('/sesion', { esquema: sesionRespuestaSchema, senal: signal }),
    retry: false,
    staleTime: Infinity,
  });

  const limpiarEmpresa = useCallback(() => {
    borrarTokenDeSesion();
    borrarSoporteEnCurso();
    setHayToken(false);
    setSoporte(null);
    clientes.removeQueries({ queryKey: CLAVE_SESION });
    // Nada de lo que se leyó con esa sesión debe quedar a la vista de la siguiente persona.
    clientes.removeQueries({ predicate: (q) => q.queryKey[0] !== 'plataforma' });
  }, [clientes]);

  const limpiarPlataforma = useCallback(() => {
    borrarSesionDePlataforma();
    setPlataforma(null);
    clientes.removeQueries({ queryKey: ['plataforma'] });
  }, [clientes]);

  // Estado actual para el manejador de 401, que vive fuera de React.
  const referencias = useRef({ soporte, limpiarEmpresa, limpiarPlataforma });
  useEffect(() => {
    referencias.current = { soporte, limpiarEmpresa, limpiarPlataforma };
  });

  useEffect(() => {
    configurarApi({
      alSesionInvalida: (ambito, codigo) => {
        const motivo: MotivoDeCierre = codigo === 'SESION_EXPIRADA' ? 'expirada' : 'revocada';
        const actual = referencias.current;
        if (ambito === 'plataforma') {
          setSalida({ a: '/plataforma/ingreso', estado: { aviso: motivo } });
          actual.limpiarPlataforma();
          actual.limpiarEmpresa();
          return;
        }
        // Un soporte que vence devuelve al panel: la sesión del superadministrador sigue viva.
        setSalida({ a: actual.soporte ? '/plataforma' : '/ingreso', estado: { aviso: motivo } });
        actual.limpiarEmpresa();
      },
    });
  }, []);

  const ingresar = useCallback(
    (respuesta: IngresoRespuesta) => {
      setSalida(null);
      guardarTokenDeSesion(respuesta.token);
      clientes.setQueryData(CLAVE_SESION, respuesta.sesion);
      setHayToken(true);
    },
    [clientes],
  );

  const actualizarSesion = useCallback(
    (sesion: SesionRespuesta) => {
      clientes.setQueryData(CLAVE_SESION, sesion);
    },
    [clientes],
  );

  const releer = useCallback(
    async (opciones?: { segundoPlano?: boolean }) => {
      if (tokenDeSesion() === null) return null;
      const sesion = await api.get('/sesion', {
        esquema: sesionRespuestaSchema,
        ...(opciones?.segundoPlano ? { segundoPlano: true } : {}),
      });
      clientes.setQueryData(CLAVE_SESION, sesion);
      return sesion;
    },
    [clientes],
  );

  const salir = useCallback(
    async (motivo?: MotivoDeCierre) => {
      const enSoporte = soporteEnCurso() !== null;
      // Se avisa a la API sin esperar: la persona no debe quedarse mirando una rueda para salir.
      void api.delete('/sesion', { reintentos: 1 }).catch(() => undefined);
      setSalida({
        a: enSoporte ? '/plataforma' : '/ingreso',
        estado: motivo ? { aviso: motivo } : {},
      });
      limpiarEmpresa();
    },
    [limpiarEmpresa],
  );

  const iniciarSoporte = useCallback(
    (respuesta: IngresoRespuesta, empresa: { id: string; nombre: string }) => {
      const datos: SoporteEnCurso = {
        empresaId: empresa.id,
        empresaNombre: empresa.nombre,
        iniciadoEn: new Date().toISOString(),
      };
      // Si había otro soporte abierto en esta pestaña, se cierra: la llamada toma el token vigente al salir.
      if (tokenDeSesion() !== null)
        void api.delete('/sesion', { reintentos: 0 }).catch(() => undefined);
      guardarSoporteEnCurso(datos);
      setSoporte(datos);
      ingresar(respuesta);
    },
    [ingresar],
  );

  const terminarSoporte = useCallback(async () => {
    try {
      await api.delete('/sesion', { reintentos: 2 });
    } catch {
      // Si no llegó, la sesión de soporte vence sola (2 horas como máximo); el panel sigue siendo válido.
    }
    setSalida({ a: '/plataforma', estado: {} });
    limpiarEmpresa();
  }, [limpiarEmpresa]);

  const ingresarPlataforma = useCallback((respuesta: IngresoSuperadministradorRespuesta) => {
    setSalida(null);
    const datos: SesionPlataforma = {
      token: respuesta.token,
      superadministrador: respuesta.superadministrador,
    };
    guardarSesionDePlataforma(datos);
    setPlataforma(datos);
  }, []);

  const salirDePlataforma = useCallback(
    async (motivo?: MotivoDeCierre) => {
      void api
        .delete('/plataforma/sesion', { ambito: 'plataforma', reintentos: 1 })
        .catch(() => undefined);
      // Salir del panel también cierra un soporte que haya quedado abierto en esta pestaña.
      if (tokenDeSesion() !== null && soporteEnCurso() !== null) {
        void api.delete('/sesion', { reintentos: 1 }).catch(() => undefined);
      }
      setSalida({ a: '/plataforma/ingreso', estado: motivo ? { aviso: motivo } : {} });
      limpiarPlataforma();
      limpiarEmpresa();
    },
    [limpiarEmpresa, limpiarPlataforma],
  );

  const valor = useMemo<ContextoSesion>(
    () => ({
      salida,
      sesion: hayToken ? (consulta.data ?? null) : null,
      cargando: hayToken && consulta.isPending,
      errorDeCarga: hayToken && consulta.isError ? (consulta.error as ErrorApi) : null,
      reintentarCarga: () => void consulta.refetch(),
      hayToken,
      ingresar,
      actualizarSesion,
      releer,
      salir,
      soporte,
      iniciarSoporte,
      terminarSoporte,
      plataforma,
      ingresarPlataforma,
      salirDePlataforma,
    }),
    [
      salida,
      hayToken,
      consulta,
      ingresar,
      actualizarSesion,
      releer,
      salir,
      soporte,
      iniciarSoporte,
      terminarSoporte,
      plataforma,
      ingresarPlataforma,
      salirDePlataforma,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** A dónde va la persona justo después de ingresar o de cambiar su contraseña. */
export function destinoTrasIngreso(sesion: SesionRespuesta): string {
  if (sesion.debeCambiarContrasena) return '/cambiar-contrasena';
  if (!sesion.sucursal && sesion.sucursales.length > 0) return '/sucursal';
  return '/';
}
