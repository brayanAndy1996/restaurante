import { Aviso, BaldosaDeOpcion, Cenefa, EstadoVacio, IconoTienda } from '@restaurante/ui';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { etiquetaDeRol } from '../../lib/formato';
import { destinoTrasIngreso, useSesion, useSesionActiva } from './sesion';
import { MENSAJES_SUCURSAL, elegirSucursal } from './sucursal';

/** Elegir la sucursal en la que se trabaja: se pide cuando hay varias (criterio 93). */
export function ElegirSucursalPagina() {
  const sesion = useSesionActiva();
  const { actualizarSesion, salir } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const errorInicial = (ubicacion.state as { error?: string } | null)?.error ?? null;
  const [error, setError] = useState<string | null>(errorInicial);
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  async function elegir(id: string) {
    setEligiendo(id);
    setError(null);
    try {
      const nueva = await elegirSucursal(id);
      actualizarSesion(nueva);
      navegar(destinoTrasIngreso(nueva), { replace: true });
    } catch (e) {
      setError(mensajeDeError(e instanceof ErrorApi ? e : null, MENSAJES_SUCURSAL));
      setEligiendo(null);
    }
  }

  return (
    <div className="entrada">
      <Cenefa estado="normal" />
      <div className="entrada__marca">Restaurante</div>
      <div className="entrada__cuerpo">
        <div>
          <h1 className="ui-titulo">Elige tu sucursal</h1>
          <p className="ui-subtitulo">
            {sesion.usuario ? `${sesion.usuario.nombre}, ¿` : '¿'}en cuál vas a trabajar ahora?
          </p>
        </div>
        {error ? (
          <Aviso tipo="error" titulo="No pudimos cambiar de sucursal">
            {error}
          </Aviso>
        ) : null}
        {sesion.sucursales.length === 0 ? (
          <EstadoVacio icono={IconoTienda} titulo="No tienes sucursales">
            Pide a tu administrador que te dé acceso a una sucursal.
          </EstadoVacio>
        ) : (
          <div className="formulario__grupo">
            {sesion.sucursales.map((s) => (
              <BaldosaDeOpcion
                key={s.id}
                titulo={s.nombre}
                detalle={etiquetaDeRol(s.rol)}
                activa={s.id === sesion.sucursal?.id}
                disabled={eligiendo !== null}
                onElegir={() => void elegir(s.id)}
              />
            ))}
          </div>
        )}
        <div className="entrada__pie">
          <button type="button" className="ui-boton ui-boton--texto" onClick={() => void salir()}>
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
