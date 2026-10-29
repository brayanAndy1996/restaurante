import { Client } from 'pg';
import { prepararBaseDeDatos } from '../scripts/lib/preparar-bd';
import { migrarArriba } from '../scripts/lib/migraciones';
import { sqlTablaDeEmpresaTrazable } from '../src/migraciones/sql-tabla-de-empresa';
import { BASE_DE_PRUEBA, urlDeRol } from './utilidades/bd';

// TEMPORAL (T9, c2a): crea además anulacion_item y precuenta provisionales para validar la migración de pedidos.
export default async function preparar(): Promise<void> {
  await prepararBaseDeDatos({
    baseDeDatos: BASE_DE_PRUEBA,
    recrear: true,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  await migrarArriba(urlDeRol('migrador'));
  if (process.env.C2A_SIN_EXTRA === '1') return;
  const c = new Client({ connectionString: urlDeRol('migrador') });
  await c.connect();
  await c.query(`
CREATE TABLE anulacion_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  item_id uuid NOT NULL, orden_id uuid NOT NULL,
  cantidad smallint NOT NULL, motivo text NOT NULL, destino_stock text NOT NULL,
  autorizado_por_id uuid, autorizacion_id uuid, de_orden boolean NOT NULL, huella_entrada bytea NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id)
);
${sqlTablaDeEmpresaTrazable('anulacion_item', { privilegiosApi: ['SELECT', 'INSERT'], privilegiosPlataforma: [], llaveDeEquipo: true })}
CREATE TABLE precuenta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL, numero smallint NOT NULL, lineas jsonb NOT NULL, total numeric(10,2) NOT NULL,
  emitida_en timestamptz NOT NULL, invalidada_en timestamptz, version_orden integer NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id)
);
CREATE UNIQUE INDEX precuenta_numero_unico ON precuenta (empresa_id, orden_id, numero);
CREATE UNIQUE INDEX precuenta_vigente_unica ON precuenta (empresa_id, orden_id) WHERE invalidada_en IS NULL;
${sqlTablaDeEmpresaTrazable('precuenta', { privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'], privilegiosPlataforma: [], llaveDeEquipo: true })}
`);
  await c.end();
}
