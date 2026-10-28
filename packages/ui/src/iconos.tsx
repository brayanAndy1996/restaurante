import type { LucideIcon } from 'lucide-react';
import { clases } from './utilidades';

/** Tipo de un icono del vocabulario, para quien recibe uno como propiedad. */
export type { LucideIcon };

/** Vocabulario único de iconos de la app: Lucide, contorno, trazo de 1.75 px. */
export {
  ArrowLeft as IconoVolver,
  ArrowLeftRight as IconoCambiar,
  Ban as IconoBloqueo,
  Check as IconoOk,
  ChevronDown as IconoAbajo,
  ChevronLeft as IconoIzquierda,
  ChevronRight as IconoDerecha,
  CircleAlert as IconoError,
  CircleCheck as IconoExito,
  Clock as IconoReloj,
  Copy as IconoCopiar,
  Delete as IconoBorrar,
  Eye as IconoOjo,
  EyeOff as IconoOjoCerrado,
  House as IconoInicio,
  Info as IconoInfo,
  KeyRound as IconoLlave,
  LoaderCircle as IconoCargando,
  Lock as IconoCandado,
  LogOut as IconoSalir,
  Pencil as IconoEditar,
  Plus as IconoMas,
  RefreshCw as IconoReintentar,
  Search as IconoBuscar,
  ShieldCheck as IconoEscudo,
  Shuffle as IconoAzar,
  Smartphone as IconoCelular,
  Store as IconoTienda,
  TriangleAlert as IconoAlerta,
  Unlink as IconoOlvidar,
  User as IconoPersona,
  UserCheck as IconoReactivar,
  Users as IconoUsuarios,
  UserX as IconoDesactivar,
  WifiOff as IconoSinRed,
  X as IconoCerrar,
  Building2 as IconoEmpresa,
  CalendarClock as IconoSuscripcion,
  Package as IconoPlan,
  Banknote as IconoPago,
  UtensilsCrossed as IconoCarta,
  Camera as IconoCamara,
  Image as IconoImagen,
  ArrowUp as IconoSubir,
  ArrowDown as IconoBajar,
  Trash2 as IconoBasura,
  ArrowUpDown as IconoOrdenar,
  ChefHat as IconoEstacion,
  Layers as IconoFamilia,
  ChevronUp as IconoArriba,
  ListChecks as IconoGrupo,
} from 'lucide-react';

interface PropsIcono {
  icono: LucideIcon;
  /** Tamaño en px: 24 (normal), 20 (dentro de un botón o campo) o 16 (dentro de una etiqueta). */
  tamano?: 16 | 20 | 24 | 32;
  className?: string;
  girando?: boolean;
}

/** Icono decorativo: siempre va acompañado de texto, así que se oculta a los lectores de pantalla. */
export function Icono({ icono: Componente, tamano = 24, className, girando }: PropsIcono) {
  return (
    <Componente
      className={clases('ui-icono', girando && 'ui-girando', className)}
      size={tamano}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  );
}
