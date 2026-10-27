import type { PlanRespuesta } from '@restaurante/contratos';
import { CampoSeleccion, CampoTexto } from '@restaurante/ui';
import { REGIMENES, type EmisorForm, type Errores, type SucursalForm } from './empresa-form';
import { NOMBRE_DE_REGIMEN } from './plataforma';

interface PropsEmisor {
  valor: Pick<EmisorForm, 'ruc' | 'razonSocial' | 'regimen'>;
  onCambio: (parcial: Partial<Pick<EmisorForm, 'ruc' | 'razonSocial' | 'regimen'>>) => void;
  errores: Errores;
  /** Prefijo de las rutas de error (`emisores.0.`); vacío si el formulario es de un solo emisor. */
  prefijo?: string;
}

/** RUC, razón social y régimen de un emisor. */
export function CamposDeEmisor({ valor, onCambio, errores, prefijo = '' }: PropsEmisor) {
  return (
    <>
      <CampoTexto
        etiqueta="RUC"
        inputMode="numeric"
        maxLength={11}
        value={valor.ruc}
        onChange={(e) => onCambio({ ruc: e.target.value })}
        error={errores[`${prefijo}ruc`]}
        autoComplete="off"
      />
      <CampoTexto
        etiqueta="Razón social"
        value={valor.razonSocial}
        onChange={(e) => onCambio({ razonSocial: e.target.value })}
        error={errores[`${prefijo}razonSocial`]}
        autoComplete="off"
      />
      <CampoSeleccion
        etiqueta="Régimen tributario"
        value={valor.regimen}
        onChange={(e) => onCambio({ regimen: e.target.value as EmisorForm['regimen'] })}
        error={errores[`${prefijo}regimen`]}
      >
        <option value="">Elige un régimen</option>
        {REGIMENES.map((r) => (
          <option key={r} value={r}>
            {NOMBRE_DE_REGIMEN[r]}
          </option>
        ))}
      </CampoSeleccion>
    </>
  );
}

interface PropsSucursal {
  valor: SucursalForm;
  onCambio: (parcial: Partial<SucursalForm>) => void;
  errores: Errores;
  prefijo?: string;
  emisores: { id: string; texto: string }[];
  planes: PlanRespuesta[];
  /** Fecha de hoy en Lima (`AAAA-MM-DD`): el vencimiento no puede ser anterior. */
  hoy: string;
}

/** Datos de una sucursal y de su suscripción (plan y vencimiento opcionales). */
export function CamposDeSucursal({
  valor,
  onCambio,
  errores,
  prefijo = '',
  emisores,
  planes,
  hoy,
}: PropsSucursal) {
  return (
    <>
      <CampoTexto
        etiqueta="Nombre de la sucursal"
        value={valor.nombre}
        onChange={(e) => onCambio({ nombre: e.target.value })}
        error={errores[`${prefijo}nombre`]}
        autoComplete="off"
      />
      <CampoSeleccion
        etiqueta="Emisor"
        value={valor.emisorId}
        onChange={(e) => onCambio({ emisorId: e.target.value })}
        error={errores[`${prefijo}rucEmisor`]}
      >
        <option value="">Elige un emisor</option>
        {emisores.map((o) => (
          <option key={o.id} value={o.id}>
            {o.texto}
          </option>
        ))}
      </CampoSeleccion>
      <CampoTexto
        etiqueta="Código de establecimiento"
        inputMode="numeric"
        maxLength={4}
        value={valor.codigoEstablecimiento}
        onChange={(e) => onCambio({ codigoEstablecimiento: e.target.value })}
        error={errores[`${prefijo}codigoEstablecimiento`]}
        ayuda="4 dígitos. Es el que figura en la SUNAT para este local."
        autoComplete="off"
      />
      <CampoTexto
        etiqueta="Dirección"
        value={valor.direccion}
        onChange={(e) => onCambio({ direccion: e.target.value })}
        error={errores[`${prefijo}direccion`]}
        autoComplete="off"
      />
      <CampoTexto
        etiqueta="WhatsApp"
        opcional
        type="tel"
        inputMode="tel"
        placeholder="+51987654321"
        value={valor.whatsapp}
        onChange={(e) => onCambio({ whatsapp: e.target.value })}
        error={errores[`${prefijo}whatsapp`]}
        autoComplete="off"
      />
      <CampoSeleccion
        etiqueta="Plan"
        opcional
        value={valor.planId}
        onChange={(e) => onCambio({ planId: e.target.value })}
        error={errores[`${prefijo}suscripcion.planId`]}
      >
        <option value="">Plan por defecto</option>
        {planes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
            {p.porDefecto ? ' (por defecto)' : ''}
          </option>
        ))}
      </CampoSeleccion>
      <CampoTexto
        etiqueta="Vencimiento"
        opcional
        type="date"
        min={hoy}
        value={valor.vencimiento}
        onChange={(e) => onCambio({ vencimiento: e.target.value })}
        error={errores[`${prefijo}suscripcion.vencimiento`]}
      />
    </>
  );
}
