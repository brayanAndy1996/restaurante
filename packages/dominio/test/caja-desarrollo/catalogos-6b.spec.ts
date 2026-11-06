import { describe, expect, it } from 'vitest';
import {
  ALERTAS_COMPROBANTE,
  AFECTACION_SUNAT,
  AFECTACION_SUNAT_GRATUITA,
  DIAS_ENLACE_COMPROBANTE,
  ESPERAS_REINTENTO_MINUTOS,
  MINUTOS_ALERTA_PENDIENTE,
  PLAZOS_ENVIO_DIAS,
  esperadoDelTurno,
  DOCUMENTO_SUNAT_DE_CLIENTE,
  ESTADOS_ENVIO_PSE,
  MODOS_PSE,
  OPERACIONES_INTENTO_PSE,
  RESULTADOS_ENVIO_PSE,
  TIPOS_COMPROBANTE,
  TIPOS_DOCUMENTO_CLIENTE,
  TIPOS_DOCUMENTO_ELECTRONICO,
  TIPOS_NOTA_CREDITO,
  TIPOS_SERIE,
  TIPO_NOTA_SUNAT,
  TIPO_SUNAT_DE_DOCUMENTO,
  TRIBUTO_SUNAT_ICBPER,
  UNIDAD_SUNAT,
} from '../../src/caja';

describe('catálogos de 6b (criterios 120, 133, 143 y 149)', () => {
  it('los documentos electrónicos son los de 6a más las dos notas de crédito, y las series son los mismos', () => {
    expect([...TIPOS_DOCUMENTO_ELECTRONICO]).toEqual([
      ...TIPOS_COMPROBANTE,
      'NOTA_CREDITO_BOLETA',
      'NOTA_CREDITO_FACTURA',
    ]);
    expect([...TIPOS_SERIE]).toEqual([...TIPOS_DOCUMENTO_ELECTRONICO]);
  });

  it('lista los tipos de nota, los estados del envío, los modos y los resultados del PSE', () => {
    expect([...TIPOS_NOTA_CREDITO]).toEqual(['ANULACION', 'DEVOLUCION', 'CAMBIO_A_FACTURA']);
    expect([...ESTADOS_ENVIO_PSE]).toEqual([
      'PENDIENTE',
      'ESPERANDO_RESPUESTA',
      'TERMINADO',
      'DETENIDO',
    ]);
    expect([...MODOS_PSE]).toEqual(['SIMULADO', 'REAL']);
    expect([...RESULTADOS_ENVIO_PSE]).toEqual([
      'ACEPTADO',
      'RECHAZADO',
      'PENDIENTE',
      'ERROR_TRANSPORTE',
      'ERROR_CONFIGURACION',
    ]);
    expect([...OPERACIONES_INTENTO_PSE]).toEqual(['EMITIR', 'CONSULTAR']);
    expect([...ALERTAS_COMPROBANTE]).toEqual([
      'RECHAZADO',
      'DEMORADO',
      'DETENIDO',
      'SIN_CONFIGURACION',
    ]);
    expect(DIAS_ENLACE_COMPROBANTE).toBe(30);
  });

  it('los códigos de SUNAT cubren cada tipo, documento del cliente y afectación', () => {
    expect(TIPO_SUNAT_DE_DOCUMENTO).toEqual({
      BOLETA: '03',
      FACTURA: '01',
      NOTA_CREDITO_BOLETA: '07',
      NOTA_CREDITO_FACTURA: '07',
    });
    for (const tipo of TIPOS_DOCUMENTO_CLIENTE) {
      expect(DOCUMENTO_SUNAT_DE_CLIENTE[tipo], tipo).toMatch(/^[1467]$/);
    }
    expect(DOCUMENTO_SUNAT_DE_CLIENTE).toEqual({ DNI: '1', CE: '4', RUC: '6', PASAPORTE: '7' });
    expect(AFECTACION_SUNAT).toEqual({ GRAVADO: '10', EXONERADO: '20', INAFECTO: '30' });
    expect(AFECTACION_SUNAT_GRATUITA).toEqual({ GRAVADO: '15', EXONERADO: '21', INAFECTO: '31' });
    expect([...UNIDAD_SUNAT]).toEqual(['NIU', 'ZZ']);
    expect(TIPO_NOTA_SUNAT).toEqual({ ANULACION: '01', DEVOLUCION: '07' });
    expect(TRIBUTO_SUNAT_ICBPER.codigo).toBe('7152');
  });
});

describe('envíos (criterios 129, 130 y 133): las tablas de datos', () => {
  it('las esperas crecen y terminan en 60 minutos; la alerta de pendientes es a los 30', () => {
    expect([...ESPERAS_REINTENTO_MINUTOS]).toEqual([1, 2, 5, 15, 30, 60]);
    expect(MINUTOS_ALERTA_PENDIENTE).toBe(30);
  });

  it('el plazo de envío está definido para los cuatro documentos (3 días provisionales)', () => {
    expect(Object.keys(PLAZOS_ENVIO_DIAS).sort()).toEqual([...TIPOS_DOCUMENTO_ELECTRONICO].sort());
    for (const tipo of TIPOS_DOCUMENTO_ELECTRONICO) expect(PLAZOS_ENVIO_DIAS[tipo]).toBe(3);
  });
});

describe('esperadoDelTurno acepta el medio del movimiento (criterio 136), sin cambiar todavía el cálculo', () => {
  it('un movimiento con medio EFECTIVO da lo mismo que sin medio', () => {
    const base = { fondo: '200.00', pagos: [{ medio: 'EFECTIVO' as const, monto: '69.20' }] };
    const sin = esperadoDelTurno({
      ...base,
      movimientos: [{ tipo: 'EGRESO', monto: '28.00' }],
    });
    const con = esperadoDelTurno({
      ...base,
      movimientos: [{ tipo: 'EGRESO', monto: '28.00', medio: 'EFECTIVO' }],
    });
    expect(con).toEqual(sin);
    expect(sin[0]).toEqual({ medio: 'EFECTIVO', monto: '241.20' });
  });
});
