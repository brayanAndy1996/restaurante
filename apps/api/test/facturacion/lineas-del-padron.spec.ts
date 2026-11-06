import { describe, expect, it } from 'vitest';
import { leerLinea, lineasDe } from '../../src/modulos/facturacion/padron/lineas-del-padron';

// Prueba del desarrollador (T36): la lectura del texto del padrón de SUNAT, sin base de datos.

const UBIGEOS = new Map([
  ['150140', { departamento: 'LIMA', provincia: 'LIMA', distrito: 'SANTIAGO DE SURCO' }],
]);

async function* trozos(...partes: Buffer[]): AsyncGenerator<Buffer> {
  for (const parte of partes) yield parte;
}
async function juntar(origen: AsyncIterable<string>): Promise<string[]> {
  const lineas: string[] = [];
  for await (const l of origen) lineas.push(l);
  return lineas;
}

describe('leerLinea', () => {
  it('descarta lo que no es un RUC de 11 dígitos (la cabecera, 10 o 12 dígitos, letras, vacío)', () => {
    for (const linea of [
      'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO|',
      '2010007097|X|ACTIVO|HABIDO|-|-|-|-|-|-|-|-|-|-|-|',
      '201000709701|X|ACTIVO|HABIDO|-|-|-|-|-|-|-|-|-|-|-|',
      'ABCDEFGHIJK|X|ACTIVO|HABIDO|-|-|-|-|-|-|-|-|-|-|-|',
      '',
    ]) {
      expect(leerLinea(linea, UBIGEOS), linea).toBeNull();
    }
  });

  it('cambia los - por vacío y deja la dirección en null sin componentes', () => {
    expect(
      leerLinea(
        '20512345671|COMERCIAL FANTASMA|BAJA DE OFICIO|NO HABIDO|-|-|-|-|-|-|-|-|-|-|-|',
        UBIGEOS,
      ),
    ).toEqual({
      ruc: '20512345671',
      razonSocial: 'COMERCIAL FANTASMA',
      estado: 'BAJA DE OFICIO',
      condicion: 'NO HABIDO',
      ubigeo: null,
      direccion: null,
    });
  });

  it('compone la dirección con los prefijos, en orden, con la zona como viene y sin usar DEPARTAMENTO', () => {
    const fila = leerLinea(
      '10456789124|QUISPE|ACTIVO|HABIDO|-|JR.|LOS ALAMOS|URB.|LAS FLORES|450|2|5|99|B|3|',
      UBIGEOS,
    );
    expect(fila?.direccion).toBe(
      'JR. LOS ALAMOS NRO. 450 INT. 2 LOTE 5 MZA. B KM. 3 URB. LAS FLORES',
    );
  });

  it('agrega distrito, provincia y departamento solo si el ubigeo está en el catálogo', () => {
    const base = '20100070970|SUPER|ACTIVO|HABIDO|UBI|AV.|PRIMAVERA|-|-|1234|-|-|-|-|-|';
    expect(leerLinea(base.replace('UBI', '150140'), UBIGEOS)?.direccion).toBe(
      'AV. PRIMAVERA NRO. 1234 - SANTIAGO DE SURCO - LIMA - LIMA',
    );
    expect(leerLinea(base.replace('UBI', '999999'), UBIGEOS)?.direccion).toBe(
      'AV. PRIMAVERA NRO. 1234',
    );
    expect(leerLinea(base.replace('UBI', '15014'), UBIGEOS)).toMatchObject({
      ubigeo: null,
      direccion: 'AV. PRIMAVERA NRO. 1234',
    });
  });

  it('quita los NUL y tolera líneas con menos columnas', () => {
    expect(leerLinea('20100070970|SU\0PER|ACTIVO', UBIGEOS)).toMatchObject({
      razonSocial: 'SUPER',
      condicion: '',
      direccion: null,
    });
  });
});

describe('lineasDe', () => {
  it('parte en líneas sin importar dónde corte cada trozo, quita el \\r y decodifica ISO-8859-1', async () => {
    const todo = Buffer.from('PIÑÓN|1\r\nDOS|2\n\nTRES', 'latin1');
    for (let corte = 1; corte < todo.length; corte++) {
      const lineas = await juntar(lineasDe(trozos(todo.subarray(0, corte), todo.subarray(corte))));
      expect(lineas, `corte ${corte}`).toEqual(['PIÑÓN|1', 'DOS|2', '', 'TRES']);
    }
  });

  it('rechaza una línea que nunca termina', async () => {
    await expect(juntar(lineasDe(trozos(Buffer.alloc(20_000, 65))))).rejects.toThrow(
      'línea demasiado larga',
    );
  });
});
