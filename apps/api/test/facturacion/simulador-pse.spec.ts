import { describe, expect, it } from 'vitest';
import {
  SimuladorPse,
  type DocumentoPse,
  type IdDocumentoPse,
} from '../../src/modulos/facturacion/pse';

// Pruebas del desarrollador (no protegidas) del PSE simulado (historia 006, criterio 121): es la herramienta de las
// pruebas protegidas de 6b, así que su comportamiento se fija aquí.

function id(numero: number, serie = 'B001'): IdDocumentoPse {
  return { rucEmisor: '20100070970', tipoSunat: '03', serie, numero };
}

function documento(numero: number, ruc: string | null = null, serie = 'B001'): DocumentoPse {
  return {
    id: id(numero, serie),
    fechaEmision: '2026-11-06',
    moneda: 'PEN',
    emisor: {
      ruc: '20100070970',
      razonSocial: 'Restaurante SAC',
      codigoEstablecimiento: '0000',
      direccion: 'Av. Lima 1',
    },
    cliente:
      ruc === null
        ? null
        : { tipoDocumentoSunat: '6', numero: ruc, nombre: 'Cliente SAC', direccion: 'Jr. Uno 2' },
    tasaIgv: '18.00',
    lineas: [
      {
        posicion: 1,
        unidad: 'NIU',
        cantidad: 1,
        descripcion: 'Lomo saltado',
        precioUnitario: '28.00',
        valorUnitario: '23.7288135593',
        bruto: '28.00',
        descuento: '0.00',
        neto: '28.00',
        base: '23.73',
        igv: '4.27',
        afectacionSunat: '10',
        bolsas: 0,
        icbper: '0.00',
        gratuita: false,
        valorReferencial: null,
        posicionOrigen: null,
      },
    ],
    totales: {
      subtotal: '28.00',
      descuentos: '0.00',
      gravadas: '23.73',
      exoneradas: '0.00',
      inafectas: '0.00',
      gratuitas: '0.00',
      igv: '4.27',
      icbper: '0.00',
      total: '28.00',
    },
    montoEnLetras: 'VEINTIOCHO CON 00/100 SOLES',
    nota: null,
  };
}

describe('SimuladorPse · sin reglas', () => {
  it('acepta con código 0, hash por contenido, XML y CDR que dicen SIMULADO, y no tiene URL de consulta', async () => {
    const pse = new SimuladorPse();
    const resultado = await pse.emitir(documento(1), null);
    expect(resultado.tipo).toBe('ACEPTADO');
    if (resultado.tipo !== 'ACEPTADO') return;
    expect(resultado.codigoSunat).toBe('0');
    expect(resultado.observaciones).toEqual([]);
    expect(resultado.hash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(resultado.xml?.toString()).toContain('SIMULADO');
    expect(resultado.cdr?.toString()).toContain('SIMULADO');
    expect(resultado.xml!.length).toBeGreaterThan(200);
    expect(resultado.cdr!.length).toBeGreaterThan(200);
    expect(pse.urlConsulta()).toBeNull();
  });

  it('el hash depende del contenido: el mismo documento da el mismo, otro da otro', async () => {
    const a = await new SimuladorPse().emitir(documento(1), null);
    const b = await new SimuladorPse().emitir(documento(1), null);
    const c = await new SimuladorPse().emitir(documento(2), null);
    if (a.tipo !== 'ACEPTADO' || b.tipo !== 'ACEPTADO' || c.tipo !== 'ACEPTADO') throw new Error();
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('emitir dos veces el mismo identificador no registra otro documento y devuelve el resultado del primero', async () => {
    const pse = new SimuladorPse();
    const primero = await pse.emitir(documento(1), null);
    const segundo = await pse.emitir(documento(1), null);
    expect(segundo).toEqual(primero);
    expect(pse.recibidos(id(1))).toBe(1);
    expect(pse.recibidos(id(2))).toBe(0);
  });

  it('consultar devuelve lo guardado o NO_EXISTE, y no lo registra', async () => {
    const pse = new SimuladorPse();
    expect(await pse.consultar(id(1), null)).toEqual({ tipo: 'NO_EXISTE' });
    expect(pse.recibidos(id(1))).toBe(0);
    const emitido = await pse.emitir(documento(1), null);
    expect(await pse.consultar(id(1), null)).toEqual(emitido);
  });

  it('un documento de otra serie, otro tipo u otro RUC es otro identificador', async () => {
    const pse = new SimuladorPse();
    await pse.emitir(documento(1), null);
    expect(pse.recibidos(id(1, 'B002'))).toBe(0);
    expect(pse.recibidos({ ...id(1), tipoSunat: '01' })).toBe(0);
    expect(pse.recibidos({ ...id(1), rucEmisor: '20100070971' })).toBe(0);
  });

  it('llamadas() lista las operaciones en orden con su resultado', async () => {
    const pse = new SimuladorPse();
    await pse.consultar(id(1), null);
    await pse.emitir(documento(1), null);
    await pse.consultar(id(1), null);
    expect(pse.llamadas().map((l) => [l.operacion, l.resultado])).toEqual([
      ['consultar', 'NO_EXISTE'],
      ['emitir', 'ACEPTADO'],
      ['consultar', 'ACEPTADO'],
    ]);
    expect(pse.llamadas()[0]?.id).toEqual(id(1));
  });

  it('el estado se puede reiniciar', async () => {
    const pse = new SimuladorPse();
    await pse.emitir(documento(1), null);
    pse.reiniciar();
    expect(pse.recibidos(id(1))).toBe(0);
    expect(pse.llamadas()).toEqual([]);
  });
});

describe('SimuladorPse · reglas', () => {
  it('rechaza los documentos de un RUC de cliente con su código y su mensaje (origen SUNAT)', async () => {
    const pse = new SimuladorPse();
    pse.reglas.rechazarRucDeCliente('20100070970', { codigo: '2335', mensaje: 'RUC no válido' });
    expect(await pse.emitir(documento(1, '20100070970'), null)).toEqual({
      tipo: 'RECHAZADO',
      origen: 'SUNAT',
      codigo: '2335',
      mensaje: 'RUC no válido',
    });
    expect((await pse.emitir(documento(2, '20512345678'), null)).tipo).toBe('ACEPTADO');
    expect((await pse.emitir(documento(3), null)).tipo).toBe('ACEPTADO');
    // El rechazo es el resultado definitivo de ese documento: consultar lo repite.
    expect((await pse.consultar(id(1), null)).tipo).toBe('RECHAZADO');
  });

  it('rechaza un número (con o sin ceros a la izquierda)', async () => {
    const pse = new SimuladorPse();
    pse.reglas.rechazarNumero('B001-00000124', { codigo: '1033', mensaje: 'Duplicado' });
    expect((await pse.emitir(documento(124), null)).tipo).toBe('RECHAZADO');
    expect((await pse.emitir(documento(125), null)).tipo).toBe('ACEPTADO');
    pse.reglas.rechazarNumero('B002-7', { codigo: '1', mensaje: 'x' });
    expect((await pse.emitir(documento(7, null, 'B002'), null)).tipo).toBe('RECHAZADO');
  });

  it('fallarTransmision falla las próximas N llamadas sin registrar nada', async () => {
    const pse = new SimuladorPse();
    pse.reglas.fallarTransmision(2);
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ERROR_TRANSPORTE');
    expect((await pse.consultar(id(1), null)).tipo).toBe('ERROR_TRANSPORTE');
    expect(pse.recibidos(id(1))).toBe(0);
    expect((await pse.consultar(id(1), null)).tipo).toBe('NO_EXISTE');
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ACEPTADO');
  });

  it('perderRespuesta registra el documento y devuelve ERROR_TRANSPORTE; la consulta lo encuentra', async () => {
    const pse = new SimuladorPse();
    pse.reglas.perderRespuesta(1);
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ERROR_TRANSPORTE');
    expect(pse.recibidos(id(1))).toBe(1);
    expect((await pse.consultar(id(1), null)).tipo).toBe('ACEPTADO');
    // Pasada la regla, emitir de nuevo devuelve el resultado del primero sin duplicar.
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ACEPTADO');
    expect(pse.recibidos(id(1))).toBe(1);
  });

  it('responderPendiente da PENDIENTE N veces (emitir o consultar) antes de aceptar', async () => {
    const pse = new SimuladorPse();
    pse.reglas.responderPendiente(2);
    expect((await pse.emitir(documento(1), null)).tipo).toBe('PENDIENTE');
    expect((await pse.consultar(id(1), null)).tipo).toBe('PENDIENTE');
    expect((await pse.consultar(id(1), null)).tipo).toBe('ACEPTADO');
    expect(pse.recibidos(id(1))).toBe(1);
  });

  it('errorDeConfiguracion responde ERROR_CONFIGURACION N veces, o siempre hasta limpiar', async () => {
    const pse = new SimuladorPse();
    pse.reglas.errorDeConfiguracion(1);
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ERROR_CONFIGURACION');
    expect(pse.recibidos(id(1))).toBe(0);
    expect((await pse.emitir(documento(1), null)).tipo).toBe('ACEPTADO');
    pse.reglas.errorDeConfiguracion();
    expect((await pse.consultar(id(1), null)).tipo).toBe('ERROR_CONFIGURACION');
    expect((await pse.emitir(documento(2), null)).tipo).toBe('ERROR_CONFIGURACION');
    pse.reglas.limpiar();
    expect((await pse.emitir(documento(2), null)).tipo).toBe('ACEPTADO');
  });

  it('demorar hace esperar cada llamada', async () => {
    const pse = new SimuladorPse();
    pse.reglas.demorar(120);
    const inicio = Date.now();
    await pse.emitir(documento(1), null);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(110);
  });

  it('aceptarConObservaciones acepta con las observaciones dadas', async () => {
    const pse = new SimuladorPse();
    pse.reglas.aceptarConObservaciones([{ codigo: '4000', mensaje: 'Observación de prueba' }]);
    const resultado = await pse.emitir(documento(1), null);
    expect(resultado.tipo === 'ACEPTADO' && resultado.observaciones).toEqual([
      { codigo: '4000', mensaje: 'Observación de prueba' },
    ]);
  });

  it('las reglas se acumulan y limpiar() las quita todas', async () => {
    const pse = new SimuladorPse();
    pse.reglas
      .fallarTransmision(1)
      .rechazarRucDeCliente('20100070970', { codigo: '1', mensaje: 'x' })
      .demorar(1);
    pse.reglas.limpiar();
    expect((await pse.emitir(documento(1, '20100070970'), null)).tipo).toBe('ACEPTADO');
  });

  it('rechaza contadores inválidos con RangeError', () => {
    const pse = new SimuladorPse();
    expect(() => pse.reglas.fallarTransmision(-1)).toThrow(RangeError);
    expect(() => pse.reglas.perderRespuesta(1.5)).toThrow(RangeError);
  });

  it('nunca lanza por un resultado esperado y no deja que quien recibe cambie lo guardado', async () => {
    const pse = new SimuladorPse();
    const primero = await pse.emitir(documento(1), null);
    if (primero.tipo !== 'ACEPTADO') throw new Error();
    primero.xml!.fill(0);
    primero.observaciones.push({ codigo: 'x', mensaje: 'y' });
    const otra = await pse.consultar(id(1), null);
    expect(otra.tipo === 'ACEPTADO' && otra.xml?.toString()).toContain('SIMULADO');
    expect(otra.tipo === 'ACEPTADO' && otra.observaciones).toEqual([]);
  });

  it('dos emisiones simultáneas del mismo documento registran uno solo', async () => {
    const pse = new SimuladorPse();
    pse.reglas.demorar(30);
    await Promise.all([pse.emitir(documento(1), null), pse.emitir(documento(1), null)]);
    expect(pse.recibidos(id(1))).toBe(1);
  });
});
