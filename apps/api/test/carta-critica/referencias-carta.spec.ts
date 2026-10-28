// spec: 003-carta (pruebas protegidas)
//
// P3 (parte 2) · Aislamiento entre empresas de la carta por HTTP (ruta crítica), criterios 67, 68 y 69:
// - 67: en toda ruta de `/carta`, un id de B en la ruta responde 404 `NO_ENCONTRADO` y, en el cuerpo, 422
//   `REFERENCIA_INVALIDA` (o el 400 de los criterios 5 y 13), con el mismo cuerpo que un id inexistente y sin
//   cambiar nada de B ni crear nada en A; los listados y la vista solo traen datos de A (también por `ETag`);
// - 68: las claves de las fotos de A empiezan con `carta/<id de A>/`; quitar o reemplazar la foto de un
//   producto de A, o intentarlo sobre uno de B, nunca borra un archivo de B; todo evento publicado por una
//   operación de A lleva la empresa A y una sala de A (con el publicador en memoria);
// - 69: con un pool de 2 conexiones, 100 peticiones concurrentes a `GET /carta/sucursal` y a
//   `PUT /carta/sucursal/agotados/:id` alternando sesiones de A y de B devuelven y cambian solo datos de su
//   empresa.
// Hoy las rutas lanzan "No implementado" y no existen las tablas: las pruebas fallan por eso.
import { randomUUID } from 'node:crypto';
import { eventoCartaActualizadaSchema, eventoDisponibilidadSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  contarFilas,
  crearEscenarioCarta,
  exigirEstado,
  exigirSinFallos,
  idsDeLaEmpresa,
  instantaneaCarta,
  llamar,
  pngValido,
  productoSimpleNuevo,
  sembrarCarta,
  sesionContrasena,
  unico,
  uuidsEn,
  type AppCarta,
  type DatosCarta,
  type EmpresaCarta,
  type EscenarioCarta,
  type Llamada,
} from './fabrica-permisos-carta';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppCarta;
let admin: Client;

interface Mundo {
  e: EscenarioCarta;
  A: EmpresaCarta;
  B: EmpresaCarta;
  datosA: DatosCarta;
  datosB: DatosCarta;
  /** Sesión del Administrador de A sin sucursal activa. */
  tokenA: string;
  /** Sesión del Administrador de A con S1 activa. */
  tokenAActiva: string;
  tokenB: string;
  tokenBActiva: string;
  /** Clave de la foto del producto de B (la prueba verifica que nunca se borre). */
  claveFotoB: string;
}

let mundoPendiente: Promise<Mundo> | undefined;
function mundo(): Promise<Mundo> {
  mundoPendiente ??= (async () => {
    const e = await crearEscenarioCarta(ctx);
    const { A, B } = e;
    const datosA = await sembrarCarta(ctx, A.tokenAdmin);
    const datosB = await sembrarCarta(ctx, B.tokenAdmin);
    const tokenA = A.tokenAdmin;
    const tokenB = B.tokenAdmin;
    const tokenAActiva = await sesionContrasena(ctx, A.base.admin, A.S1);
    const tokenBActiva = await sesionContrasena(ctx, B.base.admin, B.S1);
    // B tiene una foto, un agotado y un menú armado: son lo que A no debe poder tocar.
    const foto = await llamar(ctx, tokenB, {
      metodo: 'put',
      ruta: `/carta/productos/${datosB.productoId}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    });
    exigirEstado(foto, 200, 'B sube una foto');
    exigirEstado(
      await llamar(ctx, tokenBActiva, {
        metodo: 'put',
        ruta: `/carta/sucursal/agotados/${datosB.ligadoId}`,
        cuerpo: {},
      }),
      200,
      'B marca un agotado',
    );
    exigirEstado(
      await llamar(ctx, tokenBActiva, {
        metodo: 'put',
        ruta: `/carta/sucursal/menu-del-dia/${datosB.menuId}`,
        cuerpo: { opciones: [datosB.opcionesMenuIds[0]] },
      }),
      200,
      'B arma su menú',
    );
    const claveFotoB = ctx.almacen.claves().find((c) => c.startsWith(`carta/${B.empresaId}/`));
    if (!claveFotoB) throw new Error('La foto de B no quedó en el almacén');
    return { e, A, B, datosA, datosB, tokenA, tokenAActiva, tokenB, tokenBActiva, claveFotoB };
  })();
  return mundoPendiente;
}

beforeAll(async () => {
  ctx = await arrancarCarta({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** Foto de todo lo que una petición rechazada no debe cambiar: tablas de las dos empresas, auditoría, archivos y eventos. */
async function foto(m: Mundo) {
  return {
    tablasA: await instantaneaCarta(admin, m.A.empresaId),
    tablasB: await instantaneaCarta(admin, m.B.empresaId),
    auditoriaA: await auditoriaCarta(admin, m.A.empresaId),
    auditoriaB: await auditoriaCarta(admin, m.B.empresaId),
    claves: ctx.almacen.claves(),
  };
}

// ------------------------------------------------------------------------------------------------
// 67 · Un id de B en la ruta
// ------------------------------------------------------------------------------------------------
interface CasoDeRuta {
  nombre: string;
  /** Qué sesión de A usa: sin sucursal activa o con S1 activa (agotados y menú). */
  sesion: 'config' | 'activa';
  construir: (m: Mundo, ids: { producto: string; sucursal: string; otro: string }) => Llamada;
  /** Qué id se reemplaza: el de B o uno inexistente. */
  objetivo: 'producto' | 'sucursal' | 'otro';
}

const casosDeRuta = (): CasoDeRuta[] => {
  const sobreProducto = (
    nombre: string,
    sesion: 'config' | 'activa',
    construir: (m: Mundo, id: string) => Llamada,
  ): CasoDeRuta => ({
    nombre,
    sesion,
    objetivo: 'producto',
    construir: (m, ids) => construir(m, ids.producto),
  });
  return [
    {
      nombre: 'PATCH /carta/estaciones/:id',
      sesion: 'config',
      objetivo: 'otro',
      construir: (_m, ids) => ({
        metodo: 'patch',
        ruta: `/carta/estaciones/${ids.otro}`,
        cuerpo: { nombre: unico('Estación') },
      }),
    },
    {
      nombre: 'PATCH /carta/familias/:id',
      sesion: 'config',
      objetivo: 'otro',
      construir: (_m, ids) => ({
        metodo: 'patch',
        ruta: `/carta/familias/${ids.otro}`,
        cuerpo: { nombre: unico('Familia') },
      }),
    },
    {
      nombre: 'PUT /carta/familias/:id/productos/orden',
      sesion: 'config',
      objetivo: 'otro',
      construir: (_m, ids) => ({
        metodo: 'put',
        ruta: `/carta/familias/${ids.otro}/productos/orden`,
        cuerpo: { ids: [] },
      }),
    },
    sobreProducto('GET /carta/productos/:id', 'config', (_m, id) => ({
      metodo: 'get',
      ruta: `/carta/productos/${id}`,
    })),
    sobreProducto('PATCH /carta/productos/:id', 'config', (_m, id) => ({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { precio: '99.00' },
    })),
    sobreProducto('PUT /carta/productos/:id/foto', 'config', (_m, id) => ({
      metodo: 'put',
      ruta: `/carta/productos/${id}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    })),
    sobreProducto('DELETE /carta/productos/:id/foto', 'config', (_m, id) => ({
      metodo: 'delete',
      ruta: `/carta/productos/${id}/foto`,
    })),
    sobreProducto('GET /carta/productos/:id/sucursales', 'config', (_m, id) => ({
      metodo: 'get',
      ruta: `/carta/productos/${id}/sucursales`,
    })),
    sobreProducto(
      'PUT /carta/productos/:id/sucursales/:sucursalId (producto de B)',
      'config',
      (m, id) => ({
        metodo: 'put',
        ruta: `/carta/productos/${id}/sucursales/${m.A.S1}`,
        cuerpo: { precio: '27.50', disponible: false },
      }),
    ),
    {
      nombre: 'PUT /carta/productos/:id/sucursales/:sucursalId (sucursal de B)',
      sesion: 'config',
      objetivo: 'sucursal',
      construir: (m, ids) => ({
        metodo: 'put',
        ruta: `/carta/productos/${m.datosA.productoId}/sucursales/${ids.sucursal}`,
        cuerpo: { precio: '27.50', disponible: false },
      }),
    },
    {
      nombre: 'GET /carta/grupos-modificadores/:id',
      sesion: 'config',
      objetivo: 'otro',
      construir: (_m, ids) => ({ metodo: 'get', ruta: `/carta/grupos-modificadores/${ids.otro}` }),
    },
    {
      nombre: 'PATCH /carta/grupos-modificadores/:id',
      sesion: 'config',
      objetivo: 'otro',
      construir: (_m, ids) => ({
        metodo: 'patch',
        ruta: `/carta/grupos-modificadores/${ids.otro}`,
        cuerpo: { nombre: unico('Grupo') },
      }),
    },
    sobreProducto('PUT /carta/sucursal/menu-del-dia/:productoId', 'activa', (_m, id) => ({
      metodo: 'put',
      ruta: `/carta/sucursal/menu-del-dia/${id}`,
      cuerpo: { opciones: [] },
    })),
    sobreProducto('PUT /carta/sucursal/agotados/:productoId', 'activa', (_m, id) => ({
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${id}`,
      cuerpo: { hasta: 'FIN_DEL_DIA' },
    })),
    sobreProducto('DELETE /carta/sucursal/agotados/:productoId', 'activa', (_m, id) => ({
      metodo: 'delete',
      ruta: `/carta/sucursal/agotados/${id}`,
    })),
  ];
};

describe('criterio 67 · un id de B en la ruta responde 404 con el mismo cuerpo que un id inexistente', () => {
  it('cada ruta con id de /carta: 404 NO_ENCONTRADO, mismo cuerpo, y nada cambia en B ni en A', async () => {
    const m = await mundo();
    const fallos: string[] = [];
    for (const caso of casosDeRuta()) {
      const idDeB = {
        producto: m.datosB.productoId,
        sucursal: m.B.S1,
        // Producto de B para las rutas de producto; familia, estación o grupo de B según la ruta.
        otro: caso.nombre.includes('estaciones')
          ? m.datosB.estacionId
          : caso.nombre.includes('familias')
            ? m.datosB.familiaId
            : m.datosB.grupoId,
      };
      const inexistente = { producto: randomUUID(), sucursal: randomUUID(), otro: randomUUID() };
      const token = caso.sesion === 'config' ? m.tokenA : m.tokenAActiva;
      const antes = await foto(m);
      await asentar();
      ctx.publicador.limpiar();
      const resB = await llamar(ctx, token, caso.construir(m, idDeB));
      const resX = await llamar(ctx, token, caso.construir(m, inexistente));
      const codigoB = (resB.body as { codigo?: string } | undefined)?.codigo;
      if (resB.status !== 404 || codigoB !== 'NO_ENCONTRADO') {
        fallos.push(
          `${caso.nombre}: con id de B se esperaba 404 NO_ENCONTRADO y fue ${resB.status} ${codigoB}`,
        );
      }
      if (resX.status !== 404) {
        fallos.push(`${caso.nombre}: con id inexistente se esperaba 404 y fue ${resX.status}`);
      }
      if (JSON.stringify(resB.body) !== JSON.stringify(resX.body)) {
        fallos.push(
          `${caso.nombre}: el cuerpo con id de B (${JSON.stringify(resB.body)}) se distingue del inexistente (${JSON.stringify(resX.body)})`,
        );
      }
      const despues = await foto(m);
      if (JSON.stringify(despues) !== JSON.stringify(antes)) {
        fallos.push(`${caso.nombre}: cambió una fila, la auditoría o el almacén`);
      }
      await asentar();
      if (ctx.publicador.eventos().length > 0) fallos.push(`${caso.nombre}: publicó un evento`);
    }
    exigirSinFallos(fallos);
    expect(ctx.almacen.claves()).toContain(m.claveFotoB);
  });
});

// ------------------------------------------------------------------------------------------------
// 67 · Un id de B en el cuerpo
// ------------------------------------------------------------------------------------------------
interface CasoDeCuerpo {
  nombre: string;
  /** Campo de `campos` que debe señalarse (422); en los 400 de orden no se comprueba. */
  campo?: string;
  estado: 422 | 400;
  codigo: 'REFERENCIA_INVALIDA' | 'DATOS_INVALIDOS';
  /** `valor` es el id de B o uno inexistente (de la clase `ref`). */
  ref: 'grupo' | 'familia' | 'estacion' | 'producto' | 'sucursal' | 'modificador' | 'ligado';
  construir: (m: Mundo, valor: string, familiasDeA: string[]) => Llamada;
}

const casosDeCuerpo = (): CasoDeCuerpo[] => {
  const nuevo = (m: Mundo, extra: Record<string, unknown>) =>
    productoSimpleNuevo({ familiaId: m.datosA.familiaId, estacionId: m.datosA.estacionId }, extra);
  return [
    {
      nombre: 'POST /carta/productos con familiaId de B',
      campo: 'familiaId',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'familia',
      construir: (m, v) => ({
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: nuevo(m, { familiaId: v }),
      }),
    },
    {
      nombre: 'POST /carta/productos con estacionId de B',
      campo: 'estacionId',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'estacion',
      construir: (m, v) => ({
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: nuevo(m, { estacionId: v }),
      }),
    },
    {
      nombre: 'POST /carta/productos con un grupo de B',
      campo: 'gruposModificadores',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'grupo',
      construir: (m, v) => ({
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: nuevo(m, { gruposModificadores: [v] }),
      }),
    },
    {
      nombre: 'POST /carta/productos (combo) con un componente de B',
      campo: 'componentes',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'producto',
      construir: (m, v) => ({
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: {
          tipo: 'COMBO',
          nombre: unico('Combo'),
          familiaId: m.datosA.familiaId,
          precio: '22.90',
          tipoControlStock: 'SIN_CONTROL',
          componentes: [{ productoId: v, cantidad: 1 }],
        },
      }),
    },
    {
      nombre: 'POST /carta/productos con una sucursal de B en noDisponibleEn',
      campo: 'noDisponibleEn',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'sucursal',
      construir: (m, v) => ({
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: nuevo(m, { noDisponibleEn: [v] }),
      }),
    },
    {
      nombre: 'PATCH /carta/productos/:id con familiaId de B',
      campo: 'familiaId',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'familia',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/productos/${m.datosA.productoId}`,
        cuerpo: { familiaId: v },
      }),
    },
    {
      nombre: 'PATCH /carta/productos/:id con estacionId de B',
      campo: 'estacionId',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'estacion',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/productos/${m.datosA.productoId}`,
        cuerpo: { estacionId: v },
      }),
    },
    {
      nombre: 'PATCH /carta/productos/:id con un grupo de B',
      campo: 'gruposModificadores',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'grupo',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/productos/${m.datosA.productoId}`,
        cuerpo: { gruposModificadores: [v] },
      }),
    },
    {
      nombre: 'PATCH /carta/productos/:id (combo) con un componente de B',
      campo: 'componentes',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'producto',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/productos/${m.datosA.comboId}`,
        cuerpo: { componentes: [{ productoId: v, cantidad: 1 }] },
      }),
    },
    {
      nombre: 'POST /carta/grupos-modificadores con un producto ligado de B',
      campo: 'modificadores',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'ligado',
      construir: (_m, v) => ({
        metodo: 'post',
        ruta: '/carta/grupos-modificadores',
        cuerpo: {
          nombre: unico('Grupo'),
          seleccion: 'UNICA',
          obligatorio: false,
          modificadores: [{ nombre: 'Opción', productoId: v }],
        },
      }),
    },
    {
      nombre: 'PATCH /carta/grupos-modificadores/:id con un producto ligado de B',
      campo: 'modificadores',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'ligado',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/grupos-modificadores/${m.datosA.grupoId}`,
        cuerpo: { modificadores: [{ nombre: 'Chicha', productoId: v }, { nombre: 'Inca Kola' }] },
      }),
    },
    {
      nombre: 'PATCH /carta/grupos-modificadores/:id con un modificador de B',
      campo: 'modificadores',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'modificador',
      construir: (m, v) => ({
        metodo: 'patch',
        ruta: `/carta/grupos-modificadores/${m.datosA.grupoId}`,
        cuerpo: { modificadores: [{ id: v, nombre: 'Chicha' }, { nombre: 'Inca Kola' }] },
      }),
    },
    {
      nombre: 'PUT /carta/sucursal/menu-del-dia/:productoId con una opción de B',
      campo: 'opciones',
      estado: 422,
      codigo: 'REFERENCIA_INVALIDA',
      ref: 'modificador',
      construir: (m, v) => ({
        metodo: 'put',
        ruta: `/carta/sucursal/menu-del-dia/${m.datosA.menuId}`,
        cuerpo: { opciones: [v] },
      }),
    },
    {
      nombre: 'PUT /carta/familias/orden con una familia de B',
      estado: 400,
      codigo: 'DATOS_INVALIDOS',
      ref: 'familia',
      construir: (_m, v, familiasDeA) => ({
        metodo: 'put',
        ruta: '/carta/familias/orden',
        cuerpo: { ids: [...familiasDeA, v] },
      }),
    },
    {
      nombre: 'PUT /carta/familias/orden con una familia de B en lugar de una de A',
      estado: 400,
      codigo: 'DATOS_INVALIDOS',
      ref: 'familia',
      construir: (_m, v, familiasDeA) => ({
        metodo: 'put',
        ruta: '/carta/familias/orden',
        cuerpo: { ids: [...familiasDeA.slice(1), v] },
      }),
    },
    {
      nombre: 'PUT /carta/familias/:id/productos/orden con un producto de B',
      estado: 400,
      codigo: 'DATOS_INVALIDOS',
      ref: 'producto',
      construir: (m, v) => ({
        metodo: 'put',
        ruta: `/carta/familias/${m.datosA.familiaId}/productos/orden`,
        cuerpo: { ids: [v] },
      }),
    },
  ];
};

describe('criterio 67 · un id de B en el cuerpo responde 422 REFERENCIA_INVALIDA (o el 400 del orden) como un id inexistente', () => {
  it('cada ruta con ids en el cuerpo: mismo cuerpo que un inexistente, campos que señalan el campo y nada cambia', async () => {
    const m = await mundo();
    const lista = await llamar(ctx, m.tokenA, { metodo: 'get', ruta: '/carta/familias' });
    exigirEstado(lista, 200, 'familias de A');
    const familiasDeA = (lista.body as { id: string }[]).map((f) => f.id);
    expect(familiasDeA.length).toBeGreaterThan(0);
    const deB: Record<CasoDeCuerpo['ref'], string> = {
      grupo: m.datosB.grupoId,
      familia: m.datosB.familiaId,
      estacion: m.datosB.estacionId,
      producto: m.datosB.productoId,
      sucursal: m.B.S1,
      modificador: m.datosB.opcionesMenuIds[0]!,
      ligado: m.datosB.ligadoId,
    };
    const fallos: string[] = [];
    for (const caso of casosDeCuerpo()) {
      const token = caso.nombre.includes('menu-del-dia') ? m.tokenAActiva : m.tokenA;
      const antes = await foto(m);
      await asentar();
      ctx.publicador.limpiar();
      const resB = await llamar(ctx, token, caso.construir(m, deB[caso.ref], familiasDeA));
      const resX = await llamar(ctx, token, caso.construir(m, randomUUID(), familiasDeA));
      for (const [etiqueta, res] of [
        ['de B', resB],
        ['inexistente', resX],
      ] as const) {
        const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
        if (res.status !== caso.estado || codigo !== caso.codigo) {
          fallos.push(
            `${caso.nombre} (${etiqueta}): se esperaba ${caso.estado} ${caso.codigo} y fue ${res.status} ${codigo}`,
          );
        }
      }
      if (JSON.stringify(resB.body) !== JSON.stringify(resX.body)) {
        fallos.push(
          `${caso.nombre}: el cuerpo con id de B (${JSON.stringify(resB.body)}) se distingue del inexistente (${JSON.stringify(resX.body)})`,
        );
      }
      if (caso.campo !== undefined) {
        const campos = ((resB.body as { campos?: { campo: string }[] }).campos ?? []).map(
          (c) => c.campo,
        );
        if (
          !campos.some(
            (c) =>
              c === caso.campo || c.startsWith(`${caso.campo}.`) || c.startsWith(`${caso.campo}[`),
          )
        ) {
          fallos.push(`${caso.nombre}: campos ${JSON.stringify(campos)} no señala ${caso.campo}`);
        }
      }
      if (JSON.stringify(await foto(m)) !== JSON.stringify(antes)) {
        fallos.push(`${caso.nombre}: cambió una fila (en A o en B), la auditoría o el almacén`);
      }
      await asentar();
      if (ctx.publicador.eventos().length > 0) fallos.push(`${caso.nombre}: publicó un evento`);
    }
    exigirSinFallos(fallos);
  });
});

// ------------------------------------------------------------------------------------------------
// 67 · Listados y vista solo con datos de A
// ------------------------------------------------------------------------------------------------
describe('criterio 67 · los listados y la vista solo traen datos de A', () => {
  it('cada listado trae exactamente las filas de A y ningún id ni nombre de B', async () => {
    const m = await mundo();
    const idsA = await idsDeLaEmpresa(admin, m.A.empresaId);
    const idsB = await idsDeLaEmpresa(admin, m.B.empresaId);
    expect(idsA.size).toBeGreaterThan(5);
    expect(idsB.size).toBeGreaterThan(5);
    const nombresDeB = (
      await admin.query<{ nombre: string }>(
        `SELECT nombre FROM producto WHERE empresa_id = $1
         UNION SELECT nombre FROM familia WHERE empresa_id = $1
         UNION SELECT nombre FROM estacion WHERE empresa_id = $1
         UNION SELECT nombre FROM grupo_modificadores WHERE empresa_id = $1`,
        [m.B.empresaId],
      )
    ).rows.map((f) => f.nombre);
    const lecturas: [
      string,
      string,
      string,
      'producto' | 'familia' | 'estacion' | 'grupo_modificadores' | null,
    ][] = [
      ['estaciones', '/carta/estaciones', m.tokenA, 'estacion'],
      ['familias', '/carta/familias', m.tokenA, 'familia'],
      ['productos', '/carta/productos', m.tokenA, 'producto'],
      ['grupos', '/carta/grupos-modificadores', m.tokenA, 'grupo_modificadores'],
      [
        'ajustes por sucursal de un producto de A',
        `/carta/productos/${m.datosA.productoId}/sucursales`,
        m.tokenA,
        null,
      ],
      ['producto de A', `/carta/productos/${m.datosA.comboId}`, m.tokenA, null],
      ['grupo de A', `/carta/grupos-modificadores/${m.datosA.grupoId}`, m.tokenA, null],
      ['vista de la sucursal', '/carta/sucursal', m.tokenAActiva, null],
      ['menú del día de la sucursal', '/carta/sucursal/menu-del-dia', m.tokenAActiva, null],
    ];
    const fallos: string[] = [];
    for (const [etiqueta, ruta, token, tabla] of lecturas) {
      const res = await llamar(ctx, token, { metodo: 'get', ruta });
      if (res.status !== 200) {
        fallos.push(`${etiqueta}: se esperaba 200 y fue ${res.status} ${res.text.slice(0, 200)}`);
        continue;
      }
      // La vista trae `fotoUrl` (criterio 47) y su clave termina en un UUID que no es el id de ninguna
      // fila (criterio 15): se revisa aparte y se quita del texto antes de buscar ids.
      let texto = res.text;
      if (ruta === '/carta/sucursal') {
        const { sinFotos, fallosFotos } = revisarFotosDeLaVista(
          res.body,
          m.A.empresaId,
          m.B.empresaId,
          idsA,
        );
        for (const fallo of fallosFotos) fallos.push(`${etiqueta}: foto ajena: ${fallo}`);
        texto = sinFotos;
      }
      const ids = uuidsEn(texto);
      const ajenos = ids.filter((id) => idsB.has(id) || !idsA.has(id));
      if (ajenos.length > 0)
        fallos.push(`${etiqueta}: trae ids que no son de A: ${ajenos.join(', ')}`);
      for (const nombre of nombresDeB) {
        if (res.text.includes(nombre)) fallos.push(`${etiqueta}: trae el nombre "${nombre}" de B`);
      }
      if (tabla !== null) {
        const esperadas = await contarFilas(admin, tabla, m.A.empresaId);
        const recibidas = (res.body as unknown[]).length;
        if (recibidas !== esperadas) {
          fallos.push(`${etiqueta}: trae ${recibidas} filas y A tiene ${esperadas}`);
        }
      }
    }
    exigirSinFallos(fallos);
  });

  it('el ETag de la vista de B no sirve para A (no hay 304) y los ETag de A y B difieren', async () => {
    const m = await mundo();
    const vistaB = await llamar(ctx, m.tokenBActiva, { metodo: 'get', ruta: '/carta/sucursal' });
    exigirEstado(vistaB, 200, 'vista de B');
    const etagB = vistaB.headers.etag as string | undefined;
    expect(etagB, 'la vista de B trae ETag').toBeTruthy();
    const vistaA = await llamar(ctx, m.tokenAActiva, { metodo: 'get', ruta: '/carta/sucursal' });
    exigirEstado(vistaA, 200, 'vista de A');
    expect(vistaA.headers.etag).toBeTruthy();
    expect(vistaA.headers.etag).not.toBe(etagB);
    const conEtagDeB = await llamar(ctx, m.tokenAActiva, {
      metodo: 'get',
      ruta: '/carta/sucursal',
      cabeceras: { 'If-None-Match': etagB! },
    });
    exigirEstado(conEtagDeB, 200, 'A con el ETag de B');
    expect(conEtagDeB.body).toEqual(vistaA.body);
    // Y con su propio ETag, 304 sin cuerpo.
    const conEtagPropio = await llamar(ctx, m.tokenAActiva, {
      metodo: 'get',
      ruta: '/carta/sucursal',
      cabeceras: { 'If-None-Match': vistaA.headers.etag as string },
    });
    expect(conEtagPropio.status).toBe(304);
  });

  it('con la sucursal de A activa, la vista nunca trae el agotado ni el menú de B', async () => {
    const m = await mundo();
    const res = await llamar(ctx, m.tokenAActiva, { metodo: 'get', ruta: '/carta/sucursal' });
    exigirEstado(res, 200, 'vista de A');
    expect(res.body.sucursalId).toBe(m.A.S1);
    const idsB = await idsDeLaEmpresa(admin, m.B.empresaId);
    expect(uuidsEn(res.text).filter((id) => idsB.has(id))).toEqual([]);
    const productos = (
      res.body.familias as { productos: { id: string; agotado: unknown }[] }[]
    ).flatMap((f) => f.productos);
    // El agotado de B no aparece en ningún producto de A.
    expect(productos.some((p) => p.id === m.datosB.ligadoId)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
// 68 · Archivos y eventos
// ------------------------------------------------------------------------------------------------
describe('criterio 68 · las fotos y los eventos son de su empresa', () => {
  it('las claves de las fotos de A empiezan con carta/<id de A>/<producto>/ y reemplazar o quitar una foto de A nunca borra un archivo de B', async () => {
    const m = await mundo();
    const producto = m.datosA.productoId;
    const patron = new RegExp(`^carta/${m.A.empresaId}/${producto}/[0-9a-f-]{36}\\.png$`);
    const subir = () =>
      llamar(ctx, m.tokenA, {
        metodo: 'put',
        ruta: `/carta/productos/${producto}/foto`,
        binario: { tipo: 'image/png', datos: pngValido() },
      });
    const primera = await subir();
    exigirEstado(primera, 200, 'A sube la primera foto');
    const clavesA1 = ctx.almacen.claves().filter((c) => c.startsWith(`carta/${m.A.empresaId}/`));
    expect(clavesA1).toHaveLength(1);
    expect(clavesA1[0]).toMatch(patron);
    expect(primera.body.fotoUrl).toBe(ctx.almacen.urlPublica(clavesA1[0]!));
    expect(ctx.almacen.claves()).toContain(m.claveFotoB);

    // Reemplazar: clave nueva bajo A, la anterior se borra, la de B sigue.
    const segunda = await subir();
    exigirEstado(segunda, 200, 'A reemplaza la foto');
    await vi.waitFor(() =>
      expect(
        ctx.almacen.claves().filter((c) => c.startsWith(`carta/${m.A.empresaId}/`)),
      ).toHaveLength(1),
    );
    const clavesA2 = ctx.almacen.claves().filter((c) => c.startsWith(`carta/${m.A.empresaId}/`));
    expect(clavesA2).toHaveLength(1);
    expect(clavesA2[0]).toMatch(patron);
    expect(clavesA2[0]).not.toBe(clavesA1[0]);
    expect(ctx.almacen.claves()).toContain(m.claveFotoB);
    const fila = await admin.query(`SELECT foto_clave FROM producto WHERE id = $1`, [producto]);
    expect(fila.rows[0].foto_clave).toBe(clavesA2[0]);

    // Quitar: se borra la de A y la de B sigue.
    exigirEstado(
      await llamar(ctx, m.tokenA, { metodo: 'delete', ruta: `/carta/productos/${producto}/foto` }),
      204,
      'A quita la foto',
    );
    await vi.waitFor(() =>
      expect(ctx.almacen.claves().filter((c) => c.startsWith(`carta/${m.A.empresaId}/`))).toEqual(
        [],
      ),
    );
    expect(ctx.almacen.claves()).toContain(m.claveFotoB);
    // Ninguna clave guardada mientras tanto sale del prefijo de su empresa.
    for (const clave of ctx.almacen.claves()) {
      expect(clave).toMatch(/^carta\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/);
    }
  });

  it('subir o quitar la foto de un producto de B desde A responde 404 y no guarda ni borra nada', async () => {
    const m = await mundo();
    const antes = ctx.almacen.claves();
    const subir = await llamar(ctx, m.tokenA, {
      metodo: 'put',
      ruta: `/carta/productos/${m.datosB.productoId}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    });
    const quitar = await llamar(ctx, m.tokenA, {
      metodo: 'delete',
      ruta: `/carta/productos/${m.datosB.productoId}/foto`,
    });
    expect(subir.status).toBe(404);
    expect(quitar.status).toBe(404);
    expect(ctx.almacen.claves()).toEqual(antes);
    expect(ctx.almacen.claves()).toContain(m.claveFotoB);
    const filaB = await admin.query(`SELECT foto_clave FROM producto WHERE id = $1`, [
      m.datosB.productoId,
    ]);
    expect(filaB.rows[0].foto_clave).toBe(m.claveFotoB);
  });

  it('todo evento publicado por una operación de A lleva la empresa A y una sala de A, y lo mismo con B', async () => {
    const m = await mundo();
    const hacerOperaciones = async (
      empresa: EmpresaCarta,
      datos: DatosCarta,
      token: string,
      tokenActiva: string,
    ) => {
      await asentar();
      ctx.publicador.limpiar();
      const precio = `${30 + Math.floor(Math.random() * 60)}.00`;
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'patch',
          ruta: `/carta/productos/${datos.productoId}`,
          cuerpo: { precio },
        }),
        200,
        'cambio de precio',
      );
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'put',
          ruta: `/carta/productos/${datos.productoId}/sucursales/${empresa.S1}`,
          cuerpo: { precio: `${precio.slice(0, -2)}50`, disponible: true },
        }),
        200,
        'ajuste de sucursal',
      );
      exigirEstado(
        await llamar(ctx, tokenActiva, {
          metodo: 'put',
          ruta: `/carta/sucursal/agotados/${datos.productoId}`,
          cuerpo: { hasta: 'REACTIVAR' },
        }),
        200,
        'agotado',
      );
      exigirEstado(
        await llamar(ctx, tokenActiva, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${datos.productoId}`,
        }),
        204,
        'reactivar',
      );
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'post',
          ruta: '/carta/familias',
          cuerpo: { nombre: unico('Familia de eventos') },
        }),
        201,
        'familia',
      );
      await vi.waitFor(() => {
        const nombres = new Set(ctx.publicador.eventos().map((ev) => ev.nombre));
        expect(nombres.has('carta.actualizada') && nombres.has('carta.disponibilidad')).toBe(true);
      });
      await asentar();
      return ctx.publicador.eventos();
    };
    const verificar = async (
      eventos: Awaited<ReturnType<typeof hacerOperaciones>>,
      empresa: EmpresaCarta,
    ) => {
      expect(eventos.length).toBeGreaterThan(0);
      const sucursalesPropias = new Set(empresa.base.sucursales.map((s) => s.id));
      const nombres = new Set<string>();
      for (const evento of eventos) {
        expect(evento.empresaId).toBe(empresa.empresaId);
        nombres.add(evento.nombre);
        const esquema =
          evento.nombre === 'carta.disponibilidad'
            ? eventoDisponibilidadSchema
            : eventoCartaActualizadaSchema;
        expect(esquema.safeParse(evento).success, JSON.stringify(evento)).toBe(true);
        if (evento.sala.tipo === 'sucursal') {
          expect(sucursalesPropias.has(evento.sala.sucursalId)).toBe(true);
        }
        const sucursalDelDato = (evento.datos as { sucursalId: string | null }).sucursalId;
        if (sucursalDelDato !== null) expect(sucursalesPropias.has(sucursalDelDato)).toBe(true);
      }
      expect([...nombres].sort()).toEqual(['carta.actualizada', 'carta.disponibilidad']);
    };
    await verificar(await hacerOperaciones(m.A, m.datosA, m.tokenA, m.tokenAActiva), m.A);
    await verificar(await hacerOperaciones(m.B, m.datosB, m.tokenB, m.tokenBActiva), m.B);
  });
});

interface VistaConFotos {
  familias?: { productos?: { id: string; fotoUrl: string | null }[] }[];
}

/**
 * Devuelve el texto de la vista sin los valores de `fotoUrl` y los fallos de cada foto: su clave debe ser
 * `carta/<empresa propia>/<id del producto>/<uuid>.<ext>`, el producto debe ser de la empresa propia y la
 * URL nunca debe contener el id de la otra empresa.
 */
function revisarFotosDeLaVista(
  cuerpo: unknown,
  empresaPropia: string,
  empresaAjena: string,
  idsPropios: Set<string>,
): { sinFotos: string; fallosFotos: string[] } {
  const copia = structuredClone(cuerpo) as VistaConFotos;
  const fallosFotos: string[] = [];
  const forma = new RegExp(
    `(^|/)carta/${empresaPropia}/([0-9a-f-]{36})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+$`,
    'i',
  );
  for (const familia of copia.familias ?? []) {
    for (const producto of familia.productos ?? []) {
      const url = producto.fotoUrl;
      if (url === null || url === undefined) continue;
      const coincide = forma.exec(url);
      if (!coincide) {
        fallosFotos.push(`${producto.id} con fotoUrl ${url}`);
      } else if (coincide[2]!.toLowerCase() !== producto.id.toLowerCase()) {
        fallosFotos.push(`${producto.id} con la foto de otro producto: ${url}`);
      } else if (!idsPropios.has(producto.id.toLowerCase())) {
        fallosFotos.push(`${producto.id} no es un producto de la empresa propia`);
      }
      if (url.toLowerCase().includes(empresaAjena.toLowerCase())) {
        fallosFotos.push(`${producto.id} con el id de la otra empresa en ${url}`);
      }
      producto.fotoUrl = null;
    }
  }
  return { sinFotos: JSON.stringify(copia), fallosFotos };
}

// ------------------------------------------------------------------------------------------------
// 69 · Concurrencia con el pool de 2 conexiones
// ------------------------------------------------------------------------------------------------
describe('criterio 69 · 100 peticiones concurrentes alternando A y B con un pool de 2', () => {
  it('GET /carta/sucursal y PUT /carta/sucursal/agotados/:id devuelven y cambian solo datos de su empresa', async () => {
    const m = await mundo();
    const idsA = await idsDeLaEmpresa(admin, m.A.empresaId);
    const idsB = await idsDeLaEmpresa(admin, m.B.empresaId);
    const productosA = [m.datosA.productoId, m.datosA.ligadoId, m.datosA.comboId];
    const productosB = [m.datosB.productoId, m.datosB.ligadoId, m.datosB.comboId];
    // Estado inicial limpio: sin agotados en ninguna de las dos.
    for (const [token, productos] of [
      [m.tokenAActiva, productosA],
      [m.tokenBActiva, productosB],
    ] as const) {
      for (const producto of productos) {
        await llamar(ctx, token, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${producto}`,
        });
      }
    }
    const peticiones = Array.from({ length: 100 }, (_, i) => {
      const esA = i % 2 === 0;
      const esVista = i % 4 < 2;
      const propios = esA ? idsA : idsB;
      const ajenos = esA ? idsB : idsA;
      const token = esA ? m.tokenAActiva : m.tokenBActiva;
      const sucursal = esA ? m.A.S1 : m.B.S1;
      const productos = esA ? productosA : productosB;
      const producto = productos[Math.floor(i / 4) % productos.length]!;
      return (async () => {
        const problemas: string[] = [];
        if (esVista) {
          const res = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/sucursal' });
          if (res.status !== 200) {
            problemas.push(`#${i} vista de ${esA ? 'A' : 'B'}: ${res.status}`);
            return problemas;
          }
          if (res.body.sucursalId !== sucursal) problemas.push(`#${i} vista con otra sucursal`);
          // El UUID final de la clave de una foto (criterio 15) no es el id de ninguna fila: se revisa
          // aparte, exigiendo la clave `carta/<empresa propia>/<producto propio>/<uuid>.<ext>`, y se
          // quita del texto antes de buscar ids para no tomarlo por intruso.
          const { sinFotos, fallosFotos } = revisarFotosDeLaVista(
            res.body,
            esA ? m.A.empresaId : m.B.empresaId,
            esA ? m.B.empresaId : m.A.empresaId,
            propios,
          );
          for (const fallo of fallosFotos) problemas.push(`#${i} vista con foto ajena: ${fallo}`);
          const intrusos = uuidsEn(sinFotos).filter((id) => ajenos.has(id) || !propios.has(id));
          if (intrusos.length > 0)
            problemas.push(`#${i} vista con ids ajenos: ${intrusos.join(',')}`);
        } else {
          const res = await llamar(ctx, token, {
            metodo: 'put',
            ruta: `/carta/sucursal/agotados/${producto}`,
            cuerpo: { hasta: 'FIN_DEL_DIA' },
          });
          if (res.status !== 200) {
            problemas.push(`#${i} agotado de ${esA ? 'A' : 'B'}: ${res.status}`);
            return problemas;
          }
          if (res.body.productoId !== producto || res.body.sucursalId !== sucursal) {
            problemas.push(
              `#${i} agotado con otro producto o sucursal: ${JSON.stringify(res.body)}`,
            );
          }
        }
        return problemas;
      })();
    });
    const problemas = (await Promise.all(peticiones)).flat();
    exigirSinFallos(problemas);

    // Solo cambió su empresa: las filas de agotado de cada una son de sus productos y de su sucursal.
    const filas = await admin.query<{
      empresa_id: string;
      producto_id: string;
      sucursal_id: string;
    }>(
      `SELECT empresa_id, producto_id, sucursal_id FROM producto_agotado
        WHERE empresa_id = ANY($1::uuid[]) ORDER BY producto_id`,
      [[m.A.empresaId, m.B.empresaId]],
    );
    const deA = filas.rows.filter((f) => f.empresa_id === m.A.empresaId);
    const deB = filas.rows.filter((f) => f.empresa_id === m.B.empresaId);
    expect(deA.map((f) => f.producto_id).sort()).toEqual([...productosA].sort());
    expect(deB.map((f) => f.producto_id).sort()).toEqual([...productosB].sort());
    expect(deA.every((f) => f.sucursal_id === m.A.S1)).toBe(true);
    expect(deB.every((f) => f.sucursal_id === m.B.S1)).toBe(true);
    // Limpieza para no condicionar otras pruebas del archivo.
    for (const [token, productos] of [
      [m.tokenAActiva, productosA],
      [m.tokenBActiva, productosB],
    ] as const) {
      for (const producto of productos) {
        await llamar(ctx, token, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${producto}`,
        });
      }
    }
  });
});
