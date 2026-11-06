import { describe, expect, it } from 'vitest';
import { leerCatalogoDeUbigeo } from '../../src/modulos/facturacion/padron/catalogo-ubigeo';

// Prueba del desarrollador (T36): el catálogo del INEI del repositorio (`apps/api/datos/ubigeo.csv`).
describe('catálogo de ubigeo del INEI', () => {
  it('trae los 1892 distritos con código de seis dígitos único y sus nombres', async () => {
    const catalogo = await leerCatalogoDeUbigeo();
    expect(catalogo.filas).toHaveLength(1892);
    expect(catalogo.version).toMatch(/^[0-9a-f]{16}$/);
    expect(catalogo.filas.find((f) => f.codigo === '150140')).toEqual({
      codigo: '150140',
      departamento: 'LIMA',
      provincia: 'LIMA',
      distrito: 'SANTIAGO DE SURCO',
    });
    expect(catalogo.filas.find((f) => f.codigo === '150101')?.distrito).toBe('LIMA');
    expect(new Set(catalogo.filas.map((f) => f.departamento)).size).toBe(25);
  });
});
