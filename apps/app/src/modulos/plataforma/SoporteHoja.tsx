import { ingresoRespuestaSchema } from '@restaurante/contratos';
import { Aviso, Boton, CampoAreaTexto, CampoSeleccion, Hoja, IconoEscudo } from '@restaurante/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { destinoTrasIngreso, useSesion } from '../acceso/sesion';

/** Lo mínimo de una empresa para entrar a dar soporte. */
export interface EmpresaParaSoporte {
  id: string;
  nombre: string;
  sucursales: { id: string; nombre: string }[];
}

const MENSAJES_SOPORTE = {
  NO_ENCONTRADO: 'Esa empresa o sucursal ya no existe. Actualiza la lista e inténtalo de nuevo.',
} as const;

/** Pide el motivo y abre la sesión de soporte (criterio 66): queda auditada y la empresa la puede ver. */
export function HojaDeSoporte({
  empresa,
  onCerrar,
}: {
  empresa: EmpresaParaSoporte | null;
  onCerrar: () => void;
}) {
  const { iniciarSoporte } = useSesion();
  const navegar = useNavigate();
  const [motivo, setMotivo] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [fallo, setFallo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    if (!empresa || cargando) return;
    const texto = motivo.trim();
    if (texto === '') {
      setErrorMotivo('Escribe el motivo del soporte');
      return;
    }
    if (Array.from(texto).length > 300) {
      setErrorMotivo('Usa 300 caracteres como máximo');
      return;
    }
    setErrorMotivo(undefined);
    setFallo(null);
    setCargando(true);
    try {
      const respuesta = await api.post(
        `/plataforma/empresas/${empresa.id}/soporte`,
        { motivo: texto, ...(sucursalId ? { sucursalId } : {}) },
        { esquema: ingresoRespuestaSchema, ambito: 'plataforma' },
      );
      iniciarSoporte(respuesta, { id: empresa.id, nombre: empresa.nombre });
      navegar(destinoTrasIngreso(respuesta.sesion), { replace: true });
    } catch (e) {
      setFallo(mensajeDeError(e instanceof ErrorApi ? e : null, MENSAJES_SOPORTE));
    } finally {
      setCargando(false);
    }
  }

  return (
    <Hoja
      abierta={empresa !== null}
      onCerrar={onCerrar}
      titulo={empresa ? `Soporte en ${empresa.nombre}` : 'Soporte'}
    >
      <form className="formulario" onSubmit={entrar} noValidate>
        <Aviso tipo="info">
          Entrarás como administrador de esta empresa, hasta 2 horas. Queda registrado quién entró y
          por qué, y la empresa lo puede ver.
        </Aviso>
        <CampoAreaTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errorMotivo}
          ayuda="Por ejemplo: la empresa pidió ayuda para configurar sus usuarios."
          maxLength={300}
          rows={3}
        />
        {empresa && empresa.sucursales.length > 1 ? (
          <CampoSeleccion
            etiqueta="Sucursal"
            opcional
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
          >
            <option value="">Elegir al entrar</option>
            {empresa.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </CampoSeleccion>
        ) : null}
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos entrar">
            {fallo}
          </Aviso>
        ) : null}
        <Boton
          type="submit"
          variante="principal"
          bloque
          cargando={cargando}
          textoCargando="Entrando…"
          icono={IconoEscudo}
        >
          Entrar a dar soporte
        </Boton>
        <Boton bloque onClick={onCerrar} disabled={cargando}>
          Cancelar
        </Boton>
      </form>
    </Hoja>
  );
}
