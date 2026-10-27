import type { PlanRespuesta } from '@restaurante/contratos';
import { MODULOS } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  CampoTexto,
  ErrorDeCarga,
  EsqueletoDeLista,
  Interruptor,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import type { Errores } from './empresa-form';
import { CLAVES, NOMBRE_DE_MODULO, crearPlan, listarPlanes, modificarPlan } from './plataforma';
import {
  cambiosDelPlan,
  entradaDePlan,
  formularioDePlan,
  hayCambiosDePlan,
  planVacio,
  validarPlan,
  type PlanForm,
} from './plan-form';

const MENSAJES = {
  CONFLICTO:
    'Siempre debe haber un plan por defecto activo. Marca otro plan como por defecto antes de quitárselo a este o de desactivarlo.',
} as const;

const atras = { a: '/plataforma/planes', etiqueta: 'Planes' };

export function PlanNuevoPagina() {
  return <FormularioDePlan modo="crear" />;
}

export function PlanEditarPagina() {
  const { id = '' } = useParams();
  const consulta = useQuery({
    queryKey: CLAVES.planes,
    queryFn: ({ signal }) => listarPlanes(signal),
  });
  if (consulta.isPending) {
    return (
      <Pagina titulo="Plan" plataforma atras={atras}>
        <EsqueletoDeLista etiqueta="Cargando el plan" conInicial={false} filas={3} />
      </Pagina>
    );
  }
  if (consulta.isError) {
    return (
      <Pagina titulo="Plan" plataforma atras={atras}>
        <ErrorDeCarga
          titulo="No pudimos cargar el plan"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  const plan = consulta.data.find((p) => p.id === id);
  if (!plan) {
    return (
      <Pagina titulo="Plan" plataforma atras={atras}>
        <Aviso tipo="error" titulo="No encontramos este plan">
          Puede que ya no exista. Vuelve a la lista de planes.
        </Aviso>
      </Pagina>
    );
  }
  return <FormularioDePlan key={plan.id + plan.actualizadoEn} modo="editar" original={plan} />;
}

function FormularioDePlan({
  modo,
  original,
}: {
  modo: 'crear' | 'editar';
  original?: PlanRespuesta;
}) {
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const [form, setForm] = useState<PlanForm>(() =>
    original ? formularioDePlan(original) : planVacio(),
  );
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambios = original ? cambiosDelPlan(original, form) : null;
  const sinCambios = modo === 'editar' && cambios !== null && !hayCambiosDePlan(cambios);

  function cambiar(parcial: Partial<PlanForm>) {
    setForm((f) => ({ ...f, ...parcial }));
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = validarPlan(form);
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      if (modo === 'crear') await crearPlan(entradaDePlan(form));
      else if (original && cambios) await modificarPlan(original.id, cambios);
      await clientes.invalidateQueries({ queryKey: CLAVES.planes });
      navegar('/plataforma/planes', { replace: true });
    } catch (e) {
      const error =
        e instanceof ErrorApi
          ? e
          : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
      const campos = erroresPorCampo(error);
      if (error.codigo === 'DATOS_INVALIDOS' && Object.keys(campos).length > 0) {
        setErrores(
          Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, mensajeDeCampo(v)])),
        );
        setFallo('Revisa los datos marcados e inténtalo de nuevo.');
      } else if (error.codigo === 'CONFLICTO' && modo === 'crear' && !form.porDefecto) {
        setErrores({ codigo: 'Ya existe un plan con este código. Elige otro.' });
      } else {
        setFallo(mensajeDeError(error, MENSAJES));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina
      titulo={modo === 'crear' ? 'Nuevo plan' : (original?.nombre ?? 'Plan')}
      plataforma
      atras={atras}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-plan"
          cargando={enviando}
          textoCargando="Guardando…"
          disabled={sinCambios}
        >
          {modo === 'crear' ? 'Crear plan' : 'Guardar cambios'}
        </Boton>
      }
    >
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos guardar">
          {fallo}
        </Aviso>
      ) : null}
      <form
        id="formulario-plan"
        className="formulario formulario--secciones"
        onSubmit={enviar}
        noValidate
      >
        <section className="seccion" aria-labelledby="t-plan">
          <h2 className="formulario__titulo" id="t-plan">
            Plan
          </h2>
          <CampoTexto
            etiqueta="Código"
            value={form.codigo}
            onChange={(e) => cambiar({ codigo: e.target.value })}
            error={errores.codigo}
            ayuda="Corto y sin espacios, por ejemplo BASE o PRO."
            autoComplete="off"
            autoCapitalize="characters"
          />
          <CampoTexto
            etiqueta="Nombre"
            value={form.nombre}
            onChange={(e) => cambiar({ nombre: e.target.value })}
            error={errores.nombre}
            autoComplete="off"
          />
          <CampoTexto
            etiqueta="Días de gracia"
            inputMode="numeric"
            value={form.diasGracia}
            onChange={(e) => cambiar({ diasGracia: e.target.value })}
            error={errores.diasGracia}
            ayuda="De 0 a 60. Es el plazo después del vencimiento antes de suspender la sucursal."
            autoComplete="off"
          />
        </section>

        <section className="seccion" aria-labelledby="t-precios">
          <h2 className="formulario__titulo" id="t-precios">
            Precios y cuota
          </h2>
          <CampoTexto
            etiqueta="Precio mensual (S/)"
            opcional
            inputMode="decimal"
            value={form.precioMensual}
            onChange={(e) => cambiar({ precioMensual: e.target.value })}
            error={errores.precioMensual}
            ayuda="Vacío = sin definir."
            autoComplete="off"
          />
          <CampoTexto
            etiqueta="Comprobantes incluidos al mes"
            opcional
            inputMode="numeric"
            value={form.cuotaComprobantesMes}
            onChange={(e) => cambiar({ cuotaComprobantesMes: e.target.value })}
            error={errores.cuotaComprobantesMes}
            ayuda="Pasada la cuota no se bloquea nada: se cuenta el excedente. Vacío = sin cuota."
            autoComplete="off"
          />
          <CampoTexto
            etiqueta="Precio por comprobante excedente (S/)"
            opcional
            inputMode="decimal"
            value={form.precioExcedente}
            onChange={(e) => cambiar({ precioExcedente: e.target.value })}
            error={errores.precioExcedente}
            ayuda="Hasta 4 decimales. Vacío = sin definir."
            autoComplete="off"
          />
        </section>

        <section className="seccion" aria-labelledby="t-modulos">
          <h2 className="formulario__titulo" id="t-modulos">
            Módulos incluidos
          </h2>
          <p className="texto-ayuda">
            Una sucursal solo ve y usa los módulos de su plan. El cambio rige desde su siguiente
            acción.
          </p>
          {MODULOS.map((m) => (
            <Interruptor
              key={m}
              etiqueta={NOMBRE_DE_MODULO[m]}
              marcado={form.modulos[m]}
              onCambio={(marcado) => cambiar({ modulos: { ...form.modulos, [m]: marcado } })}
            />
          ))}
        </section>

        <section className="seccion" aria-labelledby="t-estado">
          <h2 className="formulario__titulo" id="t-estado">
            Estado
          </h2>
          <Interruptor
            etiqueta="Plan por defecto"
            ayuda="Lo usan las sucursales nuevas que no traen un plan. Solo hay uno; marcar este se lo quita al anterior."
            marcado={form.porDefecto}
            onCambio={(porDefecto) => cambiar({ porDefecto })}
          />
          <Interruptor
            etiqueta="Activo"
            ayuda="Un plan inactivo no se puede asignar a sucursales nuevas."
            marcado={form.activo}
            onCambio={(activo) => cambiar({ activo })}
          />
          {errores.activo ? (
            <p className="ui-campo__mensaje" role="alert">
              {errores.activo}
            </p>
          ) : null}
        </section>

        <section className="seccion" aria-labelledby="t-motivo">
          <h2 className="formulario__titulo" id="t-motivo">
            Auditoría
          </h2>
          <CampoAreaTexto
            etiqueta="Motivo"
            value={form.motivo}
            onChange={(e) => cambiar({ motivo: e.target.value })}
            error={errores.motivo}
            ayuda="Queda registrado con tu nombre."
            maxLength={300}
            rows={2}
          />
        </section>
      </form>
    </Pagina>
  );
}
