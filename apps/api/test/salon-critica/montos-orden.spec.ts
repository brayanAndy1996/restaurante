// spec: 004-salon-cocina (pruebas protegidas)
//
// P1 (parte API) · Criterios 21, 51, 55 (en el total) y 76: el tope de monto de una línea y del total de la
// orden al enviar (422 `MONTO_FUERA_DE_RANGO` sin nada guardado), el total de `GET /ordenes/:id` y de la
// pre-cuenta igual a `totalOrden` de `packages/dominio` con los mismos datos (antes y después de anular un
// combo), sin desglose de IGV, y las dos notas de la pre-cuenta (con y sin un ítem vigente con ICBPER).
//
// La carta de ejemplo se arma con las rutas de `/carta` de 003, las zonas y mesas con las rutas de 3a, las
// empresas con `POST /plataforma/empresas` y los usuarios con `POST /usuarios`. La app real corre con
// `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`.
import {
  ordenRespuestaSchema,
  precuentaRespuestaSchema,
  type OrdenRespuesta,
} from '@restaurante/contratos';
import { MONTO_MAXIMO, totalOrden } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  abrirOrden,
  anularItemCrudo,
  clavesDe,
  crearEmpresas,
  crearEntornoSalon,
  crearZona,
  enviar,
  enviarCrudo,
  esperarErrorDe,
  exigir,
  filasDeLaOrden,
  lineaSimple,
  lineasDelEjemplo,
  pedirPrecuenta,
  personaConRol,
  sembrarCartaDeEjemplo,
  sesionAdminEn,
  sesionConSucursal,
  verOrden,
  type CartaDeEjemplo,
  type EntornoSalon,
} from './fabrica-p0p1';
import { consultar, type Libre } from '../acceso/fabrica-equipos';

// ---------------------------------------------------------------------------------------------
// Escenario (se arma al usarlo por primera vez)
// ---------------------------------------------------------------------------------------------

const NOTA_BASE = 'Precios con IGV incluido. No es un comprobante de pago.';
const NOTA_ICBPER = 'El ICBPER se suma al cobrar.';

interface Escenario {
  entorno: EntornoSalon;
  carta: CartaDeEjemplo;
  nuevaMesa: () => Promise<string>;
  tokenMozo: () => Promise<string>;
  tokenSupervisor: () => Promise<string>;
}

let entornoCreado: EntornoSalon | undefined;
let promesa: Promise<Escenario> | undefined;

function escenario(): Promise<Escenario> {
  return (promesa ??= (async () => {
    const entorno = await crearEntornoSalon();
    entornoCreado = entorno;
    const { A } = await crearEmpresas(entorno, 2);
    const S1 = A.sucursales[0]!.id;
    const admin = await sesionAdminEn(entorno, A, S1);
    const carta = await sembrarCartaDeEjemplo(entorno.app, admin);
    const zona = await crearZona(entorno.app, admin, S1);
    const mozo = await personaConRol(entorno, A, 'MOZO', S1);
    const supervisor = await personaConRol(entorno, A, 'SUPERVISOR', S1);
    return {
      entorno,
      carta,
      nuevaMesa: zona.nuevaMesa,
      tokenMozo: () => sesionConSucursal(entorno, mozo, S1),
      tokenSupervisor: () => sesionConSucursal(entorno, supervisor, S1),
    };
  })());
}

afterAll(async () => {
  await entornoCreado?.cerrar();
});

/** Abre una mesa nueva con el Mozo y devuelve lo necesario para trabajar la orden. */
async function ordenNueva(e: Escenario): Promise<{ ordenId: string; mozo: string }> {
  const mozo = await e.tokenMozo();
  const ordenId = await abrirOrden(e.entorno.app, mozo, await e.nuevaMesa());
  return { ordenId, mozo };
}

const camposDe = (res: { body: Libre }): string[] =>
  ((res.body.campos ?? []) as { campo: string }[]).map((c) => c.campo);

/** Lo mismo que muestra la orden, pero calculado con `totalOrden` de `packages/dominio`. */
function totalConDominio(orden: OrdenRespuesta): string {
  return totalOrden(
    orden.items.map((i) => ({
      precioUnitario: i.precioUnitario,
      cantidad: i.cantidad,
      cantidadAnulada: i.cantidadAnulada,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Criterio 21 · tope de monto
// ---------------------------------------------------------------------------------------------

describe('criterio 21 · tope de monto al enviar', () => {
  it('un producto de 99999999.00 × 2 se rechaza con 422 MONTO_FUERA_DE_RANGO y no se guarda nada', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    e.entorno.publicador.limpiar();

    const res = await enviarCrudo(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.joya.id, 2)]);
    esperarErrorDe(res, 422, 'MONTO_FUERA_DE_RANGO');
    expect(camposDe(res)).toContain('lineas.0');

    expect(await filasDeLaOrden(ordenId)).toEqual({ envios: 0, items: 0, comandas: 0 });
    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.items).toEqual([]);
    expect(orden.total).toBe('0.00');
    expect(e.entorno.publicador.eventos()).toEqual([]);
  });

  it('el mismo producto × 1 se acepta: el total de la línea y de la orden es 99999999.00', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const envio = await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.joya.id, 1)]);
    expect(envio.items).toHaveLength(1);
    expect(envio.items[0]).toMatchObject({
      precioUnitario: '99999999.00',
      cantidad: 1,
      totalVigente: '99999999.00',
    });
    const orden = await verOrden(e.entorno.app, mozo, ordenId);
    expect(orden.total).toBe('99999999.00');
  });

  it('el tope exacto (99999999.99 × 1) se acepta y × 2 se rechaza', async () => {
    const e = await escenario();
    expect(MONTO_MAXIMO).toBe('99999999.99');
    const { ordenId, mozo } = await ordenNueva(e);
    const doble = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.tesoro.id, 2),
    ]);
    esperarErrorDe(doble, 422, 'MONTO_FUERA_DE_RANGO');
    expect(await filasDeLaOrden(ordenId)).toEqual({ envios: 0, items: 0, comandas: 0 });

    const simple = await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.tesoro.id, 1)]);
    expect(simple.items[0]).toMatchObject({ totalVigente: '99999999.99' });
    expect((await verOrden(e.entorno.app, mozo, ordenId)).total).toBe('99999999.99');
  });

  it('con varias líneas, la que se pasa se señala en campos y no se guarda ninguna (todo o nada)', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    e.entorno.publicador.limpiar();
    const res = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.gaseosa.id, 2),
      lineaSimple(e.carta.joya.id, 2),
      lineaSimple(e.carta.caramelo.id, 1),
    ]);
    esperarErrorDe(res, 422, 'MONTO_FUERA_DE_RANGO');
    // La línea que se pasa va en campos; las que caben no.
    expect(camposDe(res)).toContain('lineas.1');
    expect(camposDe(res)).not.toContain('lineas.0');
    expect(camposDe(res)).not.toContain('lineas.2');
    expect(await filasDeLaOrden(ordenId)).toEqual({ envios: 0, items: 0, comandas: 0 });
    expect((await verOrden(e.entorno.app, mozo, ordenId)).items).toEqual([]);
    expect(e.entorno.publicador.eventos()).toEqual([]);
  });

  it('el total de la orden después del envío no puede pasar del tope: 422 con campos en lineas y el envío no se guarda', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.joya.id, 1)]);
    const antes = await filasDeLaOrden(ordenId);
    const ordenAntes = await verOrden(e.entorno.app, mozo, ordenId);
    e.entorno.publicador.limpiar();

    // Cada línea cabe sola (la gaseosa cuesta 9.00), pero la orden pasaría de 99999999.99.
    const res = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.gaseosa.id, 1),
    ]);
    esperarErrorDe(res, 422, 'MONTO_FUERA_DE_RANGO');
    expect(camposDe(res)).toContain('lineas');

    expect(await filasDeLaOrden(ordenId)).toEqual(antes);
    const ordenDespues = await verOrden(e.entorno.app, mozo, ordenId);
    expect(ordenDespues.total).toBe('99999999.00');
    expect(ordenDespues.items).toEqual(ordenAntes.items);
    expect(e.entorno.publicador.eventos()).toEqual([]);
  });

  it('varias líneas que caben cada una pero suman más del tope en el mismo envío también se rechazan', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const res = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.joya.id, 1),
      lineaSimple(e.carta.caramelo.id, 1),
      lineaSimple(e.carta.chicle.id, 1),
    ]);
    // 99999999.00 + 0.99 + 0.10 = 100000000.09
    esperarErrorDe(res, 422, 'MONTO_FUERA_DE_RANGO');
    expect(camposDe(res)).toContain('lineas');
    expect(await filasDeLaOrden(ordenId)).toEqual({ envios: 0, items: 0, comandas: 0 });
  });

  it('el total de la orden justo en el tope se acepta y un centavo más no', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.joya.id, 1)]);
    // 99999999.00 + 0.99 = 99999999.99, el tope exacto.
    await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.caramelo.id, 1)]);
    const enElTope = await verOrden(e.entorno.app, mozo, ordenId);
    expect(enElTope.total).toBe('99999999.99');

    // + 0.10 pasa del tope.
    const antes = await filasDeLaOrden(ordenId);
    const res = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.chicle.id, 1),
    ]);
    esperarErrorDe(res, 422, 'MONTO_FUERA_DE_RANGO');
    expect(await filasDeLaOrden(ordenId)).toEqual(antes);
    expect((await verOrden(e.entorno.app, mozo, ordenId)).total).toBe('99999999.99');
  });

  it('el total de la orden cuenta solo lo vigente: tras anular lo caro vuelve a caber', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const supervisor = await e.tokenSupervisor();
    const envio = await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.joya.id, 1)]);
    const lleno = await enviarCrudo(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.gaseosa.id, 1),
    ]);
    esperarErrorDe(lleno, 422, 'MONTO_FUERA_DE_RANGO');

    const anulacion = await anularItemCrudo(
      e.entorno.app,
      supervisor,
      ordenId,
      envio.items[0].id as string,
      { cantidad: 1 },
    );
    exigir(anulacion, 201, 'Anular el ítem caro (004, criterio 35)');
    const ahora = await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.gaseosa.id, 1)]);
    expect(ahora.numero).toBe(2);
    expect((await verOrden(e.entorno.app, mozo, ordenId)).total).toBe('9.00');
  });
});

// ---------------------------------------------------------------------------------------------
// Criterios 55 y 76 · el total de GET /ordenes/:id
// ---------------------------------------------------------------------------------------------

describe('criterios 55 y 76 · total de la orden', () => {
  it('la orden de ejemplo (Lomo × 2, Combo × 3, Menú × 1) da 169.20 y cada ítem su total vigente', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const envio = await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    expect(envio.items).toHaveLength(3);

    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    const de = (productoId: string) => orden.items.find((i) => i.productoId === productoId)!;
    expect(de(e.carta.lomo.id)).toMatchObject({
      cantidad: 2,
      cantidadAnulada: 0,
      cantidadVigente: 2,
      precioUnitario: '33.50',
      totalVigente: '67.00',
    });
    expect(de(e.carta.combo.id)).toMatchObject({
      cantidad: 3,
      precioUnitario: '28.40',
      totalVigente: '85.20',
    });
    expect(de(e.carta.menu.id)).toMatchObject({
      cantidad: 1,
      precioUnitario: '17.00',
      totalVigente: '17.00',
    });
    expect(orden.total).toBe('169.20');
    expect(orden.total).toBe(totalConDominio(orden));
  });

  it('es exacto con decimales: Chicle × 3 (0.10) y Bocadito × 999 (19.99) suman 19970.31', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.chicle.id, 3),
      lineaSimple(e.carta.bocadito.id, 999),
    ]);
    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.items.find((i) => i.productoId === e.carta.chicle.id)!.totalVigente).toBe('0.30');
    expect(orden.items.find((i) => i.productoId === e.carta.bocadito.id)!.totalVigente).toBe(
      '19970.01',
    );
    expect(orden.total).toBe('19970.31');
    expect(orden.total).toBe(totalConDominio(orden));
  });

  it('una adición suma al total de la orden', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    await enviar(e.entorno.app, mozo, ordenId, [lineaSimple(e.carta.gaseosa.id, 2)]);
    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.total).toBe('187.20');
    expect(orden.total).toBe(totalConDominio(orden));
  });

  it('con un combo anulado (1 de 3) la orden de ejemplo da 140.80 y el ítem 56.80', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const supervisor = await e.tokenSupervisor();
    const envio = await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    const combo = (envio.items as Libre[]).find((i) => i.productoId === e.carta.combo.id)!;

    const anulacion = await anularItemCrudo(
      e.entorno.app,
      supervisor,
      ordenId,
      combo.id as string,
      { cantidad: 1 },
    );
    exigir(anulacion, 201, 'Anular un combo (004, criterio 35)');

    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.items.find((i) => i.productoId === e.carta.combo.id)).toMatchObject({
      cantidad: 3,
      cantidadAnulada: 1,
      cantidadVigente: 2,
      totalVigente: '56.80',
    });
    expect(orden.total).toBe('140.80');
    expect(orden.total).toBe(totalConDominio(orden));
  });

  it('GET /ordenes/:id no trae desglose de IGV ni de base imponible', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, [
      ...lineasDelEjemplo(e.carta),
      lineaSimple(e.carta.bolsa.id, 1),
    ]);
    const orden = await verOrden(e.entorno.app, mozo, ordenId);
    const claves = [...clavesDe(orden)];
    expect(claves.filter((c) => /igv|imponible|subtotal|impuesto/.test(c))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 51 · total y notas de la pre-cuenta
// ---------------------------------------------------------------------------------------------

describe('criterio 51 · pre-cuenta', () => {
  it('el total es totalOrden de los ítems vigentes (169.20) y coincide con el de la orden', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));

    const res = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    const precuenta = precuentaRespuestaSchema.parse(res.body);
    expect(precuenta.numero).toBe(1);
    expect(precuenta.total).toBe('169.20');
    expect(precuenta.lineas).toHaveLength(3);
    const lineaDe = (nombre: string) => precuenta.lineas.find((l) => l.nombre === nombre)!;
    expect(lineaDe('Lomo saltado')).toMatchObject({
      cantidad: 2,
      precioUnitario: '33.50',
      total: '67.00',
    });
    expect(lineaDe('Combo hamburguesa')).toMatchObject({
      cantidad: 3,
      precioUnitario: '28.40',
      total: '85.20',
    });
    expect(lineaDe('Menú del día')).toMatchObject({
      cantidad: 1,
      precioUnitario: '17.00',
      total: '17.00',
    });
    // El total es la suma de los totales de las líneas, con los mismos datos.
    expect(precuenta.total).toBe(
      totalOrden(
        precuenta.lineas.map((l) => ({
          precioUnitario: l.precioUnitario,
          cantidad: l.cantidad,
          cantidadAnulada: 0,
        })),
      ),
    );

    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.total).toBe(precuenta.total);
    expect(orden.precuentaVigente).toMatchObject({ id: precuenta.id, numero: 1, total: '169.20' });
  });

  it('la respuesta no trae desglose de IGV ni de base imponible', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    const res = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    const claves = [...clavesDe(res.body)];
    expect(claves.filter((c) => /igv|imponible|subtotal|impuesto|gravad/.test(c))).toEqual([]);
    // Los montos viajan como texto con 2 decimales.
    expect(res.body.total).toMatch(/^\d+\.\d{2}$/);
    for (const linea of res.body.lineas as Libre[]) {
      expect(linea.precioUnitario).toMatch(/^\d+\.\d{2}$/);
      expect(linea.total).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('después de anular un combo (1 de 3) el total vigente es 140.80 y la pre-cuenta siguiente lo recalcula', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const supervisor = await e.tokenSupervisor();
    const envio = await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    const combo = (envio.items as Libre[]).find((i) => i.productoId === e.carta.combo.id)!;

    const primera = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(primera, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    expect(primera.body.total).toBe('169.20');

    const anulacion = await anularItemCrudo(
      e.entorno.app,
      supervisor,
      ordenId,
      combo.id as string,
      { cantidad: 1 },
    );
    exigir(anulacion, 201, 'Anular un combo (004, criterio 35)');

    // La pre-cuenta de 169.20 ya no vale (decisión 10): la orden no la muestra como vigente...
    const orden = ordenRespuestaSchema.parse(await verOrden(e.entorno.app, mozo, ordenId));
    expect(orden.total).toBe('140.80');
    expect(orden.precuentaVigente).toBeNull();
    // ...pero la que se emitió conserva sus líneas y su total tal como se emitieron.
    const [guardada] = await consultar<{ total: string; lineas: number; invalidada: boolean }>(
      `SELECT total::text AS total, jsonb_array_length(lineas) AS lineas,
              invalidada_en IS NOT NULL AS invalidada
         FROM precuenta WHERE id = $1`,
      [primera.body.id],
    );
    expect(guardada).toEqual({ total: '169.20', lineas: 3, invalidada: true });

    const segunda = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(segunda, 201, 'Pedir otra pre-cuenta (004, criterio 53)');
    const precuenta = precuentaRespuestaSchema.parse(segunda.body);
    expect(precuenta.numero).toBe(2);
    expect(precuenta.id).not.toBe(primera.body.id);
    expect(precuenta.total).toBe('140.80');
    expect(precuenta.lineas.find((l) => l.nombre === 'Combo hamburguesa')).toMatchObject({
      cantidad: 2,
      total: '56.80',
    });
  });

  it('sin ítems con ICBPER la nota es solo "Precios con IGV incluido. No es un comprobante de pago."', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    const res = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    expect(res.body.nota).toBe(NOTA_BASE);
    expect(res.body.nota).not.toContain('ICBPER');
  });

  it('con un ítem vigente con ICBPER agrega "El ICBPER se suma al cobrar." y no desglosa su monto', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.gaseosa.id, 1),
      lineaSimple(e.carta.bolsa.id, 2),
    ]);
    const res = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    expect(res.body.nota).toContain(NOTA_BASE);
    expect(res.body.nota).toContain(NOTA_ICBPER);
    expect(res.body.nota.indexOf(NOTA_BASE)).toBeLessThan(res.body.nota.indexOf(NOTA_ICBPER));
    // El total es la suma de los precios (la bolsa cuesta 0.50): el ICBPER no se suma aquí.
    expect(res.body.total).toBe('10.00');
  });

  it('el ICBPER solo se menciona mientras el ítem tenga cantidad vigente', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    const supervisor = await e.tokenSupervisor();
    const envio = await enviar(e.entorno.app, mozo, ordenId, [
      lineaSimple(e.carta.gaseosa.id, 1),
      lineaSimple(e.carta.bolsa.id, 2),
    ]);
    const bolsa = (envio.items as Libre[]).find((i) => i.productoId === e.carta.bolsa.id)!;

    // Anula 1 de 2: queda una vigente.
    exigir(
      await anularItemCrudo(e.entorno.app, supervisor, ordenId, bolsa.id as string, {
        cantidad: 1,
      }),
      201,
      'Anular una bolsa (004, criterio 35)',
    );
    const conUna = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(conUna, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    expect(conUna.body.total).toBe('9.50');
    expect(conUna.body.nota).toContain(NOTA_ICBPER);

    // Anula la que quedaba: ya no hay ítem vigente con ICBPER.
    exigir(
      await anularItemCrudo(e.entorno.app, supervisor, ordenId, bolsa.id as string, {
        cantidad: 1,
      }),
      201,
      'Anular la última bolsa (004, criterio 35)',
    );
    const sinBolsa = await pedirPrecuenta(e.entorno.app, mozo, ordenId);
    exigir(sinBolsa, 201, 'Pedir otra pre-cuenta (004, criterio 53)');
    expect(sinBolsa.body.total).toBe('9.00');
    expect(sinBolsa.body.nota).toBe(NOTA_BASE);
    expect((sinBolsa.body.lineas as Libre[]).map((l) => l.nombre)).toEqual(['Gaseosa 1 L']);
  });

  it('repetir el mismo id devuelve la misma pre-cuenta, con el mismo número y total', async () => {
    const e = await escenario();
    const { ordenId, mozo } = await ordenNueva(e);
    await enviar(e.entorno.app, mozo, ordenId, lineasDelEjemplo(e.carta));
    const id = randomUUID();
    const res = await pedirPrecuenta(e.entorno.app, mozo, ordenId, { id });
    exigir(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    const otra = await pedirPrecuenta(e.entorno.app, mozo, ordenId, { id });
    exigir(otra, 201, 'Repetir la pre-cuenta (004, criterio 52)');
    expect(otra.body.id).toBe(res.body.id);
    expect(otra.body.numero).toBe(res.body.numero);
    expect(otra.body.total).toBe('169.20');
    expect(otra.body.lineas).toEqual(res.body.lineas);
  });
});
