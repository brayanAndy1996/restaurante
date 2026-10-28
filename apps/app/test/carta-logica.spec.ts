import {
  productoCrearEntradaSchema,
  type FamiliaRespuesta,
  type ProductoRespuesta,
  type ProductoResumen,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { agruparPorFamilia, puedeAjustarSucursal } from '../src/modulos/carta/carta';
import {
  ErrorDeFoto,
  LADO_MAYOR_PX,
  reducirFoto,
  tamanoReducido,
  type MotorDeImagen,
} from '../src/lib/imagen';
import { montoComoTexto, montoEnSoles, paraBuscar } from '../src/lib/formato';
import { seccionPedida, seccionesDeCarta } from '../src/modulos/carta/MarcoDeCarta';
import {
  SIN_ESTACION,
  cambiosDelProducto,
  entradaDeCreacion,
  formularioDeProducto,
  formularioVacio,
  hayCambios,
  validarProducto,
  type EstadoDelProducto,
} from '../src/modulos/carta/producto-form';
import { TIPOS_DE_PRODUCTO, TIPOS_HABILITADOS } from '../src/modulos/carta/tipos';
import { ID } from './ayudas';

const FAMILIA = 'f0000000-0000-4000-8000-000000000001';
const ESTACION = 'e0000000-0000-4000-8000-000000000001';

function producto(parcial: Partial<ProductoRespuesta> = {}): ProductoRespuesta {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    tipo: 'SIMPLE',
    nombre: 'Ceviche mixto',
    familiaId: FAMILIA,
    precio: '38.00',
    seVendeSolo: true,
    estacionId: ESTACION,
    tipoControlStock: 'PORCIONES',
    fotoUrl: null,
    activo: true,
    orden: 1,
    descripcion: null,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    grupos: [],
    componentes: [],
    usadoEn: { combos: [], modificadores: [] },
    creadoEn: '2026-10-29T10:00:00.000Z',
    actualizadoEn: '2026-10-29T10:00:00.000Z',
    ...parcial,
  };
}

function lleno(parcial: Partial<EstadoDelProducto> = {}): EstadoDelProducto {
  return {
    ...formularioVacio([ID.sucursalA, ID.sucursalB]),
    nombre: 'Ceviche mixto',
    familiaId: FAMILIA,
    precio: '38',
    estacionId: ESTACION,
    tipoControlStock: 'PORCIONES',
    ...parcial,
  };
}

describe('montoComoTexto', () => {
  it('lleva lo que escribe una persona al texto decimal de la API, sin números de coma flotante', () => {
    expect(montoComoTexto('28')).toBe('28.00');
    expect(montoComoTexto('28.5')).toBe('28.50');
    expect(montoComoTexto(' S/ 1234.05 ')).toBe('1234.05');
    expect(montoComoTexto('0.10')).toBe('0.10');
    expect(montoComoTexto('99999999.99')).toBe('99999999.99');
  });

  it('rechaza lo que la API rechazaría: cero, negativos, exponentes, más de 2 decimales y 9 enteros', () => {
    for (const malo of ['', '0', '0.00', '-1', '1e2', '0x10', '1.234', '123456789', 'abc', '1,5']) {
      expect(montoComoTexto(malo), malo).toBeNull();
    }
  });

  it('con permitirCero admite 0 (un precio extra)', () => {
    expect(montoComoTexto('0', { permitirCero: true })).toBe('0.00');
  });

  it('montoEnSoles formatea con miles y cifras fijas, y deja pasar lo que no hay', () => {
    expect(montoEnSoles('1284.5')).toBe('S/ 1,284.50');
    expect(montoEnSoles(null)).toBeNull();
    expect(montoEnSoles(undefined)).toBeNull();
  });

  it('paraBuscar ignora tildes y mayúsculas', () => {
    expect(paraBuscar('  Ají de GALLINA ')).toBe('aji de gallina');
  });
});

describe('validación del formulario de producto', () => {
  it('un formulario vacío dice qué falta, campo por campo', () => {
    const errores = validarProducto(formularioVacio([]));
    expect(errores).toEqual({
      nombre: 'Escribe el nombre del producto',
      familiaId: 'Elige la familia del producto',
      precio: 'Escribe el precio con IGV',
      estacionId: 'Elige la estación, o "Ninguna" si no va a cocina ni a barra',
      tipoControlStock: 'Elige cómo se controla el stock',
    });
  });

  it('"Ninguna" es una estación elegida; sin elegir no lo es', () => {
    expect(validarProducto(lleno({ estacionId: SIN_ESTACION })).estacionId).toBeUndefined();
    expect(validarProducto(lleno({ estacionId: '' })).estacionId).toBeDefined();
  });

  it('el precio debe ser un monto válido y mayor que 0', () => {
    expect(validarProducto(lleno({ precio: '0' })).precio).toBe('El precio debe ser mayor que 0');
    expect(validarProducto(lleno({ precio: '1.234' })).precio).toBe(
      'Escribe un monto válido, por ejemplo 28.50',
    );
    expect(validarProducto(lleno({ precio: '28.5' })).precio).toBeUndefined();
  });

  it('si no se vende solo no pide el precio', () => {
    expect(validarProducto(lleno({ seVendeSolo: false, precio: '' })).precio).toBeUndefined();
  });

  it('respeta los largos (en caracteres, no en unidades de UTF-16)', () => {
    expect(validarProducto(lleno({ nombre: 'a'.repeat(101) })).nombre).toBe(
      'Usa 100 caracteres como máximo',
    );
    expect(validarProducto(lleno({ nombre: '🍤'.repeat(100) })).nombre).toBeUndefined();
    expect(validarProducto(lleno({ descripcion: 'a'.repeat(501) })).descripcion).toBe(
      'Usa 500 caracteres como máximo',
    );
  });
});

describe('entrada de creación', () => {
  it('se vende solo y gravado por defecto, y la acepta el contrato de la API', () => {
    const entrada = entradaDeCreacion(lleno());
    expect(entrada).toEqual({
      tipo: 'SIMPLE',
      nombre: 'Ceviche mixto',
      familiaId: FAMILIA,
      seVendeSolo: true,
      precio: '38.00',
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: ESTACION,
      tipoControlStock: 'PORCIONES',
    });
    expect(productoCrearEntradaSchema.safeParse(entrada).success).toBe(true);
  });

  it('"Ninguna" viaja como null y la descripción vacía no se envía', () => {
    const entrada = entradaDeCreacion(lleno({ estacionId: SIN_ESTACION, descripcion: '  ' }));
    expect(entrada.estacionId).toBeNull();
    expect('descripcion' in entrada).toBe(false);
    expect(productoCrearEntradaSchema.safeParse(entrada).success).toBe(true);
  });

  it('un producto que no se vende solo no lleva precio', () => {
    const entrada = entradaDeCreacion(lleno({ seVendeSolo: false, precio: '12' }));
    expect(entrada.seVendeSolo).toBe(false);
    expect('precio' in entrada).toBe(false);
    expect(productoCrearEntradaSchema.safeParse(entrada).success).toBe(true);
  });

  it('las sucursales desmarcadas van en noDisponibleEn; sin ninguna, el campo no se envía', () => {
    const base = lleno();
    expect('noDisponibleEn' in entradaDeCreacion(base)).toBe(false);
    const entrada = entradaDeCreacion({
      ...base,
      disponibleEn: { [ID.sucursalA]: true, [ID.sucursalB]: false },
    });
    expect(entrada.noDisponibleEn).toEqual([ID.sucursalB]);
  });
});

describe('cambios de un producto guardado', () => {
  it('sin tocar nada no hay cambios', () => {
    const original = producto({ descripcion: 'Con leche de tigre', precio: '38.00' });
    expect(hayCambios(cambiosDelProducto(original, formularioDeProducto(original)))).toBe(false);
  });

  it('un precio escrito distinto pero igual en valor ("38") no cuenta como cambio', () => {
    const original = producto();
    expect(
      hayCambios(cambiosDelProducto(original, { ...formularioDeProducto(original), precio: '38' })),
    ).toBe(false);
  });

  it('envía solo lo que cambió', () => {
    const original = producto();
    const estado = {
      ...formularioDeProducto(original),
      nombre: ' Ceviche clásico ',
      precio: '40.5',
      estacionId: SIN_ESTACION,
    };
    expect(cambiosDelProducto(original, estado)).toEqual({
      nombre: 'Ceviche clásico',
      precio: '40.50',
      estacionId: null,
    });
  });

  it('dejar de venderse solo manda precio null; volver a venderse manda el precio', () => {
    const original = producto();
    expect(
      cambiosDelProducto(original, { ...formularioDeProducto(original), seVendeSolo: false }),
    ).toEqual({ seVendeSolo: false, precio: null });
    const sinPrecio = producto({ seVendeSolo: false, precio: null });
    expect(
      cambiosDelProducto(sinPrecio, {
        ...formularioDeProducto(sinPrecio),
        seVendeSolo: true,
        precio: '12',
      }),
    ).toEqual({ seVendeSolo: true, precio: '12.00' });
  });

  it('vaciar la descripción manda null', () => {
    const original = producto({ descripcion: 'Con leche de tigre' });
    expect(
      cambiosDelProducto(original, { ...formularioDeProducto(original), descripcion: ' ' }),
    ).toEqual({ descripcion: null });
  });
});

describe('tipos de producto', () => {
  it('hoy solo el simple está habilitado; el combo y el menú del día están definidos para cuando lleguen', () => {
    expect(TIPOS_HABILITADOS.map((t) => t.valor)).toEqual(['SIMPLE']);
    expect(TIPOS_DE_PRODUCTO.map((t) => t.valor)).toEqual(['SIMPLE', 'COMBO', 'MENU_DEL_DIA']);
  });
});

describe('secciones de la carta', () => {
  it('"Estaciones" solo la ve quien administra', () => {
    expect(seccionesDeCarta(true).map((s) => s.valor)).toEqual([
      'productos',
      'familias',
      'modificadores',
      'estaciones',
    ]);
    expect(seccionesDeCarta(false).map((s) => s.valor)).toEqual([
      'productos',
      'familias',
      'modificadores',
    ]);
  });

  it('una sección desconocida o no permitida cae en "Productos"', () => {
    expect(seccionPedida('familias', false)).toBe('familias');
    expect(seccionPedida('estaciones', false)).toBe('productos');
    expect(seccionPedida('estaciones', true)).toBe('estaciones');
    expect(seccionPedida('otra', true)).toBe('productos');
    expect(seccionPedida(null, true)).toBe('productos');
  });
});

describe('puedeAjustarSucursal', () => {
  const sucursal = (rol: 'CAJERO' | 'MOZO' | 'SUPERVISOR' | 'COCINA_BARRA' | 'ADMINISTRADOR') => ({
    id: ID.sucursalA,
    nombre: 'Miraflores',
    rol,
  });

  it('el Administrador, en todas', () => {
    expect(puedeAjustarSucursal({ esAdministrador: true }, sucursal('ADMINISTRADOR'))).toBe(true);
  });

  it('el Cajero, solo donde es Cajero; el Mozo, el Supervisor y Cocina/Barra, en ninguna', () => {
    const sesion = { esAdministrador: false };
    expect(puedeAjustarSucursal(sesion, sucursal('CAJERO'))).toBe(true);
    expect(puedeAjustarSucursal(sesion, sucursal('MOZO'))).toBe(false);
    expect(puedeAjustarSucursal(sesion, sucursal('SUPERVISOR'))).toBe(false);
    expect(puedeAjustarSucursal(sesion, sucursal('COCINA_BARRA'))).toBe(false);
  });
});

describe('agruparPorFamilia', () => {
  const familia = (id: string, nombre: string, orden: number): FamiliaRespuesta => ({
    id,
    nombre,
    orden,
    activa: true,
    productos: 0,
    creadoEn: '2026-10-29T10:00:00.000Z',
    actualizadoEn: '2026-10-29T10:00:00.000Z',
  });
  const resumen = (id: string, familiaId: string): ProductoResumen => {
    const {
      descripcion,
      afectacionIgv,
      aplicaIcbper,
      grupos,
      componentes,
      usadoEn,
      creadoEn,
      actualizadoEn,
      ...base
    } = producto({ id, familiaId, nombre: id });
    void [
      descripcion,
      afectacionIgv,
      aplicaIcbper,
      grupos,
      componentes,
      usadoEn,
      creadoEn,
      actualizadoEn,
    ];
    return base;
  };

  it('sigue el orden de las familias y el de los productos, y omite las familias vacías', () => {
    const familias = [
      familia('f1', 'Entradas', 1),
      familia('f2', 'Fondos', 2),
      familia('f3', 'Bebidas', 3),
    ];
    const productos = [resumen('p1', 'f2'), resumen('p2', 'f1'), resumen('p3', 'f2')];
    const grupos = agruparPorFamilia(familias, productos);
    expect(grupos.map((g) => [g.familia.nombre, g.productos.map((p) => p.id)])).toEqual([
      ['Entradas', ['p2']],
      ['Fondos', ['p1', 'p3']],
    ]);
  });
});

describe('reducir la foto', () => {
  function motor(
    ancho: number,
    alto: number,
    pesos: number[],
  ): MotorDeImagen & {
    codificaciones: { ancho: number; alto: number; calidad: number }[];
    liberada: () => boolean;
  } {
    let liberada = false;
    const codificaciones: { ancho: number; alto: number; calidad: number }[] = [];
    return {
      codificaciones,
      liberada: () => liberada,
      decodificar: () =>
        Promise.resolve({
          ancho,
          alto,
          origen: {} as CanvasImageSource,
          liberar: () => {
            liberada = true;
          },
        }),
      codificar: (_origen, w, h, calidad) => {
        codificaciones.push({ ancho: w, alto: h, calidad });
        const peso = pesos[codificaciones.length - 1] ?? pesos[pesos.length - 1] ?? 1;
        return Promise.resolve(new Blob([new Uint8Array(peso)], { type: 'image/jpeg' }));
      },
    };
  }
  const original = new File([new Uint8Array(4_000_000)], 'foto.heic', { type: 'image/heic' });

  it('el lado mayor queda en 1200 px sin deformar, y nunca agranda', () => {
    expect(tamanoReducido(4000, 3000)).toEqual({ ancho: LADO_MAYOR_PX, alto: 900 });
    expect(tamanoReducido(3000, 4000)).toEqual({ ancho: 900, alto: LADO_MAYOR_PX });
    expect(tamanoReducido(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });

  it('devuelve un JPEG a la primera calidad si ya pesa menos de 300 KB', async () => {
    const m = motor(4000, 3000, [200_000]);
    const resultado = await reducirFoto(original, m);
    expect(resultado.type).toBe('image/jpeg');
    expect(m.codificaciones).toEqual([{ ancho: 1200, alto: 900, calidad: 0.82 }]);
    expect(m.liberada()).toBe(true);
  });

  it('baja la calidad hasta llegar a 300 KB', async () => {
    const m = motor(4000, 3000, [500_000, 350_000, 250_000]);
    const resultado = await reducirFoto(original, m);
    expect(resultado.size).toBe(250_000);
    expect(m.codificaciones.map((c) => c.calidad)).toEqual([0.82, 0.72, 0.62]);
  });

  it('si ni a la peor calidad llega a 300 KB, sube la mejor que cabe en el límite de la API', async () => {
    const m = motor(4000, 3000, [900_000]);
    const resultado = await reducirFoto(original, m);
    expect(resultado.size).toBe(900_000);
    expect(m.codificaciones).toHaveLength(4);
  });

  it('una foto con un lado menor de 200 px se rechaza antes de subir, diciendo qué hacer', async () => {
    const m = motor(150, 900, [100]);
    await expect(reducirFoto(original, m)).rejects.toMatchObject({
      name: 'ErrorDeFoto',
      motivo: 'MUY_PEQUENA',
    });
    expect(m.codificaciones).toHaveLength(0);
    expect(m.liberada()).toBe(true);
  });

  it('una foto muy alargada (que al reducirla quedaría con menos de 200 px) se rechaza', async () => {
    const m = motor(6000, 500, [100]);
    await expect(reducirFoto(original, m)).rejects.toMatchObject({ motivo: 'FORMA_NO_VALIDA' });
  });

  it('si el navegador no puede leerla y ya es JPEG, PNG o WebP de hasta 1 MB, la sube tal cual', async () => {
    const jpeg = new File([new Uint8Array(500_000)], 'f.jpg', { type: 'image/jpeg' });
    const fallido: MotorDeImagen = {
      decodificar: () => Promise.reject(new Error('no')),
      codificar: () => Promise.resolve(null),
    };
    expect(await reducirFoto(jpeg, fallido)).toBe(jpeg);
  });

  it('si no puede leerla y no sirve tal cual (HEIC, o más de 1 MB), lanza un error que dice qué hacer', async () => {
    const fallido: MotorDeImagen = {
      decodificar: () => Promise.reject(new Error('no')),
      codificar: () => Promise.resolve(null),
    };
    const error = await reducirFoto(original, fallido).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeFoto);
    expect((error as ErrorDeFoto).message).toContain('JPEG, PNG o WebP');
    const grande = new File([new Uint8Array(2_000_000)], 'f.jpg', { type: 'image/jpeg' });
    await expect(reducirFoto(grande, fallido)).rejects.toMatchObject({ motivo: 'NO_SE_PUDO_LEER' });
  });
});
