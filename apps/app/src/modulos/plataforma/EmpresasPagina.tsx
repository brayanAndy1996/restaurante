import {
  empresaPlataformaResumenSchema,
  ingresoRespuestaSchema,
  type EmpresaPlataformaResumen,
} from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  CampoSeleccion,
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Hoja,
  IconoEmpresa,
  IconoEscudo,
  TablaResponsiva,
  claseFila,
  type TonoEtiqueta,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { api, listaDe } from '../../lib/api';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { fechaDeLima, pluralSucursales } from '../../lib/formato';
import { destinoTrasIngreso, useSesion } from '../acceso/sesion';

type Empresa = EmpresaPlataformaResumen;
type EstadoSuscripcion = Empresa['sucursales'][number]['estadoSuscripcion'];

const CLAVE_EMPRESAS = ['plataforma', 'empresas'] as const;

const TEXTO_ESTADO: Record<
  NonNullable<EstadoSuscripcion>,
  { texto: string; tono: TonoEtiqueta }
> = {
  ACTIVA: { texto: 'Activa', tono: 'ok' },
  EN_GRACIA: { texto: 'En gracia', tono: 'alerta' },
  SUSPENDIDA: { texto: 'Suspendida', tono: 'mal' },
};

function EtiquetasDeSucursales({ empresa }: { empresa: Empresa }) {
  return (
    <span className="etiquetas">
      {empresa.sucursales.map((s) => {
        const estado = s.estadoSuscripcion ? TEXTO_ESTADO[s.estadoSuscripcion] : null;
        return (
          <EtiquetaDeEstado key={s.id} tono={estado?.tono ?? 'neutro'}>
            {`${s.nombre} · ${estado?.texto ?? 'Sin suscripción'}`}
          </EtiquetaDeEstado>
        );
      })}
    </span>
  );
}

const MENSAJES_SOPORTE = {
  NO_ENCONTRADO: 'Esa empresa o sucursal ya no existe. Actualiza la lista e inténtalo de nuevo.',
} as const;

/** Pide el motivo y abre la sesión de soporte (criterio 66): queda auditada y la empresa la puede ver. */
function HojaDeSoporte({ empresa, onCerrar }: { empresa: Empresa | null; onCerrar: () => void }) {
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

/** Lista de empresas con el estado de suscripción de cada sucursal y la entrada a soporte (criterio 101, primera parte). */
export function EmpresasPagina() {
  const [paraSoporte, setParaSoporte] = useState<Empresa | null>(null);
  const consulta = useQuery({
    queryKey: CLAVE_EMPRESAS,
    queryFn: ({ signal }) =>
      api.get('/plataforma/empresas', {
        esquema: listaDe(empresaPlataformaResumenSchema),
        ambito: 'plataforma',
        senal: signal,
      }),
  });
  const empresas = consulta.data ?? [];

  return (
    <Pagina titulo="Plataforma" plataforma ancho="ancho">
      <div className="encabezado-de-pagina">
        <h2 className="ui-titulo">Empresas</h2>
      </div>

      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando empresas" conInicial={false} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar las empresas"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : empresas.length === 0 ? (
        <EstadoVacio icono={IconoEmpresa} titulo="Aún no hay empresas">
          Cuando se registre la primera empresa, aparecerá aquí con el estado de su suscripción.
        </EstadoVacio>
      ) : (
        <TablaResponsiva
          etiqueta="Empresas"
          filas={empresas}
          clave={(e) => e.id}
          filaEnLista={(e) => (
            <div className={claseFila()}>
              <ContenidoDeFila
                titulo={e.nombre}
                ayuda={pluralSucursales(e.sucursales.length)}
                extra={<EtiquetasDeSucursales empresa={e} />}
              />
              <Boton bloque icono={IconoEscudo} onClick={() => setParaSoporte(e)}>
                Entrar a dar soporte <span className="ui-solo-lectores">{`en ${e.nombre}`}</span>
              </Boton>
            </div>
          )}
          columnas={[
            { id: 'nombre', encabezado: 'Empresa', celda: (e) => <b>{e.nombre}</b> },
            {
              id: 'sucursales',
              encabezado: 'Sucursales y suscripción',
              celda: (e) => <EtiquetasDeSucursales empresa={e} />,
            },
            {
              id: 'creada',
              encabezado: 'Registrada',
              alinear: 'derecha',
              celda: (e) => fechaDeLima(e.creadoEn),
            },
            {
              id: 'acciones',
              encabezado: 'Acciones',
              encabezadoOculto: true,
              alinear: 'derecha',
              sinSaltos: true,
              celda: (e) => (
                <Boton icono={IconoEscudo} onClick={() => setParaSoporte(e)}>
                  Entrar a dar soporte <span className="ui-solo-lectores">{`en ${e.nombre}`}</span>
                </Boton>
              ),
            },
          ]}
        />
      )}

      <HojaDeSoporte
        key={paraSoporte?.id ?? 'ninguna'}
        empresa={paraSoporte}
        onCerrar={() => setParaSoporte(null)}
      />
    </Pagina>
  );
}
