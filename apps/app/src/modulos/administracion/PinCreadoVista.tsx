import { Aviso, PinUnaVez } from '@restaurante/ui';
import { Pagina } from '../../componentes/Pagina';

interface Props {
  titulo: string;
  nombre: string;
  pin: string;
  /** Aviso de lo que pasó ("Rosa Quispe ya puede ingresar"). */
  aviso: { titulo: string; texto: string };
  /** Contraseña temporal que se acaba de poner, para que quien la entrega la tenga a la vista. */
  contrasenaTemporal?: string;
  onListo: () => void;
  /** Dentro del panel de plataforma: barra de tinta oscura. */
  plataforma?: boolean;
}

/**
 * El PIN se muestra una sola vez (al crear, al regenerar o al cambiar de largo). Vive solo en el
 * estado de esta pantalla: no se guarda en la caché de consultas ni en ningún almacenamiento.
 */
export function PinCreadoVista({
  titulo,
  nombre,
  pin,
  aviso,
  contrasenaTemporal,
  onListo,
  plataforma,
}: Props) {
  return (
    <Pagina titulo={titulo} {...(plataforma ? { plataforma: true } : {})}>
      <Aviso tipo="ok" titulo={aviso.titulo}>
        {aviso.texto}
      </Aviso>
      {contrasenaTemporal ? (
        <div className="ui-bloque">
          <span className="texto-ayuda">Contraseña temporal</span>
          <b style={{ fontSize: '1.25rem', overflowWrap: 'anywhere', userSelect: 'all' }}>
            {contrasenaTemporal}
          </b>
          <span className="texto-ayuda">La cambiará al ingresar por primera vez.</span>
        </div>
      ) : null}
      <PinUnaVez nombre={nombre} pin={pin} onListo={onListo} />
    </Pagina>
  );
}
