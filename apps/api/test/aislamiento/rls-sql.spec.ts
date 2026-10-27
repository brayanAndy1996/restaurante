// spec: 001-base-multitenancy (pruebas protegidas)
//
// P2 · Criterios 11 (parte SQL), 12 a 16, 16b, 17, 19, 20 y 21, más los casos límite de la base:
// clientes `pg` como `restaurante_api` con `set_config`, independientes de la implementación de la API.
// Las empresas A y B se crean por SQL con `restaurante_plataforma`; cada prueba usa las suyas.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  crearEmpresaSql,
  enTransaccion,
  errorDe,
  fotoDeFila,
  rucAleatorio,
  textoUnico,
  type EmpresaSql,
} from './fabrica';

let api: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  api = await abrirCliente('api');
  plataforma = await abrirCliente('plataforma');
});

afterAll(async () => {
  await api.end();
  await plataforma.end();
});

beforeEach(async () => {
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

describe('criterio 11 · lectura por id', () => {
  it('con el contexto de A, la sucursal y el emisor de B no se obtienen; los de A sí', async () => {
    await enTransaccion(api, A.id, async () => {
      const ajenaSucursal = await api.query('SELECT * FROM sucursal WHERE id = $1', [
        B.sucursales[0]!.id,
      ]);
      expect(ajenaSucursal.rows).toEqual([]);
      const ajenoEmisor = await api.query('SELECT * FROM emisor WHERE id = $1', [
        B.emisores[0]!.id,
      ]);
      expect(ajenoEmisor.rows).toEqual([]);

      const propiaSucursal = await api.query('SELECT * FROM sucursal WHERE id = $1', [
        A.sucursales[0]!.id,
      ]);
      expect(propiaSucursal.rows).toHaveLength(1);
      const propioEmisor = await api.query('SELECT * FROM emisor WHERE id = $1', [
        A.emisores[0]!.id,
      ]);
      expect(propioEmisor.rows).toHaveLength(1);
    });
  });
});

describe('criterio 12 · listados', () => {
  it('con el contexto de A, empresa, emisor y sucursal solo muestran filas de A', async () => {
    await enTransaccion(api, A.id, async () => {
      const empresas = await api.query('SELECT id FROM empresa');
      expect(ids(empresas.rows)).toEqual([A.id]);

      const emisores = await api.query('SELECT id, empresa_id FROM emisor');
      expect(ids(emisores.rows)).toEqual(ids(A.emisores));
      expect(emisores.rows.every((f) => f.empresa_id === A.id)).toBe(true);

      const sucursales = await api.query('SELECT id, empresa_id FROM sucursal');
      expect(ids(sucursales.rows)).toEqual(ids(A.sucursales));
      expect(sucursales.rows.every((f) => f.empresa_id === A.id)).toBe(true);
    });
  });
});

describe('criterio 13 · actualización', () => {
  it('el UPDATE por id de la sucursal de B afecta 0 filas, el UPDATE sin WHERE solo filas de A y B queda idéntica', async () => {
    const antesB = await Promise.all(
      B.sucursales.map((s) => fotoDeFila(plataforma, 'sucursal', s.id)),
    );

    await enTransaccion(
      api,
      A.id,
      async () => {
        const porId = await api.query('UPDATE sucursal SET direccion = $1 WHERE id = $2', [
          'Hackeada 1',
          B.sucursales[0]!.id,
        ]);
        expect(porId.rowCount).toBe(0);

        const sinWhere = await api.query(
          'UPDATE sucursal SET direccion = $1 RETURNING empresa_id',
          ['Dirección nueva de A'],
        );
        expect(sinWhere.rowCount).toBe(A.sucursales.length);
        expect(sinWhere.rows.every((f) => f.empresa_id === A.id)).toBe(true);
      },
      { confirmar: true },
    );

    const despuesB = await Promise.all(
      B.sucursales.map((s) => fotoDeFila(plataforma, 'sucursal', s.id)),
    );
    expect(despuesB).toEqual(antesB);
  });
});

describe('criterio 14 · cambio de dueño', () => {
  it('actualizar una sucursal de A con empresa_id = B falla y la fila no cambia', async () => {
    const antes = await fotoDeFila(plataforma, 'sucursal', A.sucursales[0]!.id);
    const error = await errorDe(
      enTransaccion(api, A.id, () =>
        api.query('UPDATE sucursal SET empresa_id = $1 WHERE id = $2', [B.id, A.sucursales[0]!.id]),
      ),
    );
    expect(error.code, error.message).toBe('42501');
    expect(await fotoDeFila(plataforma, 'sucursal', A.sucursales[0]!.id)).toEqual(antes);
  });

  it('actualizar un emisor de A con empresa_id = B falla y la fila no cambia', async () => {
    const antes = await fotoDeFila(plataforma, 'emisor', A.emisores[0]!.id);
    const error = await errorDe(
      enTransaccion(api, A.id, () =>
        api.query('UPDATE emisor SET empresa_id = $1 WHERE id = $2', [B.id, A.emisores[0]!.id]),
      ),
    );
    expect(error.code, error.message).toBe('42501');
    expect(await fotoDeFila(plataforma, 'emisor', A.emisores[0]!.id)).toEqual(antes);
  });
});

describe('criterio 15 · borrado', () => {
  it('el DELETE por id de la sucursal de B afecta 0 filas', async () => {
    await enTransaccion(api, A.id, async () => {
      const resultado = await api.query('DELETE FROM sucursal WHERE id = $1', [
        B.sucursales[0]!.id,
      ]);
      expect(resultado.rowCount).toBe(0);
    });
    const { rows } = await plataforma.query('SELECT id FROM sucursal WHERE empresa_id = $1', [
      B.id,
    ]);
    expect(ids(rows)).toEqual(ids(B.sucursales));
  });

  it('el DELETE sin WHERE solo borra filas de A (y se revierte)', async () => {
    await enTransaccion(api, A.id, async () => {
      const resultado = await api.query('DELETE FROM sucursal RETURNING id, empresa_id');
      expect(resultado.rowCount).toBe(A.sucursales.length);
      expect(resultado.rows.every((f) => f.empresa_id === A.id)).toBe(true);
    });
    // La transacción se revirtió: nada se borró, ni de A ni de B.
    const { rows } = await plataforma.query('SELECT id FROM sucursal WHERE empresa_id = ANY($1)', [
      [A.id, B.id],
    ]);
    expect(ids(rows)).toEqual(ids([...A.sucursales, ...B.sucursales]));
  });
});

describe('criterio 16 · inserción ajena', () => {
  it('insertar una sucursal con empresa_id = B falla y no se crea nada', async () => {
    const nombre = textoUnico('Intrusa');
    const error = await errorDe(
      enTransaccion(api, A.id, () =>
        api.query(
          `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
           VALUES ($1, $2, $3, '0099', 'Calle falsa 123', now(), now())`,
          [B.id, B.emisores[0]!.id, nombre],
        ),
      ),
    );
    expect(error.code, error.message).toBe('42501');
    const { rows } = await plataforma.query('SELECT id FROM sucursal WHERE nombre = $1', [nombre]);
    expect(rows).toEqual([]);
  });

  it('insertar un emisor con empresa_id = B falla y no se crea nada', async () => {
    const ruc = rucAleatorio();
    const error = await errorDe(
      enTransaccion(api, A.id, () =>
        api.query(
          `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
           VALUES ($1, $2, 'Intruso SAC', 'GENERAL', now(), now())`,
          [B.id, ruc],
        ),
      ),
    );
    expect(error.code, error.message).toBe('42501');
    const { rows } = await plataforma.query('SELECT id FROM emisor WHERE ruc = $1', [ruc]);
    expect(rows).toEqual([]);
  });
});

describe('criterio 16b · inserción propia', () => {
  it('con el contexto de A se puede insertar un emisor y una sucursal de A que lo referencia; B no los ve', async () => {
    const ruc = rucAleatorio();
    const nombre = textoUnico('Nueva');
    const creados = await enTransaccion(
      api,
      A.id,
      async () => {
        const emisor = await api.query<{ id: string; empresa_id: string }>(
          `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
           VALUES ($1, $2, 'Nuevo emisor SAC', 'RER', now(), now()) RETURNING id, empresa_id`,
          [A.id, ruc],
        );
        const sucursal = await api.query<{ id: string; empresa_id: string; emisor_id: string }>(
          `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
           VALUES ($1, $2, $3, '0001', 'Av. Nueva 456', now(), now()) RETURNING id, empresa_id, emisor_id`,
          [A.id, emisor.rows[0]!.id, nombre],
        );
        return { emisor: emisor.rows[0]!, sucursal: sucursal.rows[0]! };
      },
      { confirmar: true },
    );
    expect(creados.emisor.empresa_id).toBe(A.id);
    expect(creados.sucursal.empresa_id).toBe(A.id);
    expect(creados.sucursal.emisor_id).toBe(creados.emisor.id);

    await enTransaccion(api, A.id, async () => {
      const emisores = await api.query('SELECT id FROM emisor WHERE id = $1', [creados.emisor.id]);
      const sucursales = await api.query('SELECT id FROM sucursal WHERE id = $1', [
        creados.sucursal.id,
      ]);
      expect(emisores.rows).toHaveLength(1);
      expect(sucursales.rows).toHaveLength(1);
    });
    await enTransaccion(api, B.id, async () => {
      const emisores = await api.query('SELECT id FROM emisor WHERE id = $1', [creados.emisor.id]);
      const sucursales = await api.query('SELECT id FROM sucursal WHERE id = $1', [
        creados.sucursal.id,
      ]);
      expect(emisores.rows).toEqual([]);
      expect(sucursales.rows).toEqual([]);
    });
  });
});

describe('criterio 17 · referencia cruzada', () => {
  const insertarSucursal = (empresaId: string, emisorId: string) =>
    api.query(
      `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
       VALUES ($1, $2, $3, '0050', 'Calle 1', now(), now())`,
      [empresaId, emisorId, textoUnico('Cruzada')],
    );
  const actualizarEmisor = (sucursalId: string, emisorId: string) =>
    api.query('UPDATE sucursal SET emisor_id = $1 WHERE id = $2', [emisorId, sucursalId]);

  it('insertar una sucursal de A con el emisor de B falla por la llave foránea compuesta, igual que con un emisor inexistente', async () => {
    const cruzada = await errorDe(
      enTransaccion(api, A.id, () => insertarSucursal(A.id, B.emisores[0]!.id)),
    );
    const inexistente = await errorDe(
      enTransaccion(api, A.id, () => insertarSucursal(A.id, randomUUID())),
    );
    expect(cruzada.code, cruzada.message).toBe('23503');
    expect(inexistente.code, inexistente.message).toBe('23503');
    expect(cruzada.constraint).toBeTruthy();
    expect(cruzada.constraint).toBe(inexistente.constraint);
  });

  it('actualizar la sucursal de A con el emisor de B falla por la llave foránea compuesta, igual que con un emisor inexistente', async () => {
    const sucursalId = A.sucursales[0]!.id;
    // Código de establecimiento distinto del de las sucursales de B: así la unicidad no se
    // adelanta a la llave foránea (que se verifica al final de la sentencia).
    await plataforma.query("UPDATE sucursal SET codigo_establecimiento = '0088' WHERE id = $1", [
      sucursalId,
    ]);
    const antes = await fotoDeFila(plataforma, 'sucursal', sucursalId);
    const cruzada = await errorDe(
      enTransaccion(api, A.id, () => actualizarEmisor(sucursalId, B.emisores[0]!.id)),
    );
    const inexistente = await errorDe(
      enTransaccion(api, A.id, () => actualizarEmisor(sucursalId, randomUUID())),
    );
    expect(cruzada.code, cruzada.message).toBe('23503');
    expect(inexistente.code, inexistente.message).toBe('23503');
    expect(cruzada.constraint).toBe(inexistente.constraint);
    expect(await fotoDeFila(plataforma, 'sucursal', sucursalId)).toEqual(antes);
  });
});

/** Sentencias del criterio 19: todas deben fallar sin contexto de empresa. */
function sentenciasSinContexto(
  cliente: Client,
  empresaId: string,
): [string, () => Promise<unknown>][] {
  const insertarEmisor = () =>
    cliente.query(
      `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
       VALUES ($1, $2, 'Sin contexto SAC', 'GENERAL', now(), now())`,
      [empresaId, rucAleatorio()],
    );
  const insertarSucursal = () =>
    cliente.query(
      `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
       VALUES ($1, $2, $3, '0077', 'Calle 7', now(), now())`,
      [empresaId, randomUUID(), textoUnico('SinContexto')],
    );
  return [
    ['SELECT empresa', () => cliente.query('SELECT * FROM empresa')],
    ['SELECT emisor', () => cliente.query('SELECT * FROM emisor')],
    ['SELECT sucursal', () => cliente.query('SELECT * FROM sucursal')],
    ['UPDATE empresa', () => cliente.query('UPDATE empresa SET nombre = nombre')],
    ['UPDATE emisor', () => cliente.query('UPDATE emisor SET razon_social = razon_social')],
    ['UPDATE sucursal', () => cliente.query('UPDATE sucursal SET direccion = direccion')],
    ['DELETE emisor', () => cliente.query('DELETE FROM emisor')],
    ['DELETE sucursal', () => cliente.query('DELETE FROM sucursal')],
    ['INSERT emisor', insertarEmisor],
    ['INSERT sucursal', insertarSucursal],
  ];
}

async function verificarSinContexto(cliente: Client, empresaId: string): Promise<void> {
  for (const [nombre, ejecutar] of sentenciasSinContexto(cliente, empresaId)) {
    const error = await errorDe(ejecutar());
    expect(error.code, `${nombre}: ${error.message}`).toBe('42501');
    expect(error.message, nombre).toMatch(/^contexto de empresa ausente/);
  }
}

describe('criterio 19 · sin contexto de empresa', () => {
  it('en una conexión nueva que nunca fijó app.empresa_id, toda sentencia falla con 42501 "contexto de empresa ausente"', async () => {
    const nueva = await abrirCliente('api');
    try {
      await verificarSinContexto(nueva, A.id);
    } finally {
      await nueva.end();
    }
  });

  it('las mismas sentencias dentro de una transacción sin set_config también fallan', async () => {
    const nueva = await abrirCliente('api');
    try {
      for (const [nombre, ejecutar] of sentenciasSinContexto(nueva, A.id)) {
        const error = await errorDe(enTransaccion(nueva, null, ejecutar));
        expect(error.code, `${nombre}: ${error.message}`).toBe('42501');
        expect(error.message, nombre).toMatch(/^contexto de empresa ausente/);
      }
    } finally {
      await nueva.end();
    }
  });
});

describe('criterio 20 · el contexto no sobrevive a su transacción', () => {
  it('tras una transacción con contexto confirmada, la misma conexión falla sin contexto', async () => {
    const reutilizada = await abrirCliente('api');
    try {
      const vistas = await enTransaccion(
        reutilizada,
        A.id,
        () => reutilizada.query('SELECT id FROM sucursal'),
        { confirmar: true },
      );
      expect(ids(vistas.rows)).toEqual(ids(A.sucursales));
      await verificarSinContexto(reutilizada, A.id);
    } finally {
      await reutilizada.end();
    }
  });

  it('tras una transacción con contexto revertida, la misma conexión falla sin contexto', async () => {
    const reutilizada = await abrirCliente('api');
    try {
      const vistas = await enTransaccion(reutilizada, A.id, () =>
        reutilizada.query('SELECT id FROM sucursal'),
      );
      expect(ids(vistas.rows)).toEqual(ids(A.sucursales));
      await verificarSinContexto(reutilizada, A.id);
    } finally {
      await reutilizada.end();
    }
  });
});

describe('criterio 21 · app.empresa_id inválido', () => {
  it.each(['no-es-un-uuid', '12345', "' OR '1'='1"])(
    'con el valor %j como contexto, consultar una tabla de empresa falla',
    async (valor) => {
      for (const tabla of ['empresa', 'emisor', 'sucursal']) {
        const error = await errorDe(
          enTransaccion(api, valor, () => api.query(`SELECT * FROM ${tabla}`)),
        );
        expect(error.code, `${tabla}: ${error.message}`).toBe('22P02');
      }
    },
  );

  it('con el valor vacío como contexto, consultar una tabla de empresa falla como "contexto ausente"', async () => {
    for (const tabla of ['empresa', 'emisor', 'sucursal']) {
      const error = await errorDe(
        enTransaccion(api, '', () => api.query(`SELECT * FROM ${tabla}`)),
      );
      expect(error.code, `${tabla}: ${error.message}`).toBe('42501');
      expect(error.message).toMatch(/^contexto de empresa ausente/);
    }
  });
});

describe('caso límite · UUID válido de una empresa que no existe', () => {
  it('las consultas devuelven 0 filas sin error y los INSERT fallan por llave foránea', async () => {
    const fantasma = randomUUID();
    await enTransaccion(api, fantasma, async () => {
      for (const tabla of ['empresa', 'emisor', 'sucursal']) {
        const { rows } = await api.query(`SELECT * FROM ${tabla}`);
        expect(rows, tabla).toEqual([]);
      }
    });
    const error = await errorDe(
      enTransaccion(api, fantasma, () =>
        api.query(
          `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
           VALUES ($1, $2, 'Fantasma SAC', 'GENERAL', now(), now())`,
          [fantasma, rucAleatorio()],
        ),
      ),
    );
    expect(error.code, error.message).toBe('23503');
  });
});
