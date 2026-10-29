import { describe, expect, it } from 'vitest';
import { mencionaContextoDeEmpresa } from '../src/nucleo/base-de-datos/control-transaccion';

// Historia 004, criterio 70, ronda 3 del ataque: sesiones ajenas y estado de las transacciones de otras
// empresas. Prueba unitaria del analizador (no protegida); la guarda de la API y la de plataforma usan la misma lista.
const NOMBRES = [
  'pg_stat_ssl',
  'pg_stat_gssapi',
  'pg_stat_replication',
  'pg_stat_get_progress_info',
  'pg_current_snapshot',
  'txid_current_snapshot',
  'pg_xact_status',
  'txid_status',
  'pg_current_xact_id',
  'pg_current_xact_id_if_assigned',
  'txid_current',
  'txid_current_if_assigned',
  'pg_snapshot_xmin',
  'pg_snapshot_xmax',
  'pg_snapshot_xip',
  'pg_visible_in_snapshot',
  'txid_visible_in_snapshot',
  'pg_stat_database',
  'pg_stat_database_conflicts',
];
const PREFIJOS = ['pg_stat_progress_', 'txid_snapshot_', 'pg_stat_get_db_'];

describe('nombres de la ronda 3 del ataque a 3a', () => {
  it.each(NOMBRES)('rechaza %s en sus variantes', (nombre) => {
    for (const sql of [
      `SELECT ${nombre}()`,
      `SELECT * FROM ${nombre}`,
      `SELECT pg_catalog.${nombre}()`,
      `SELECT "${nombre}"()`,
      `SELECT ${nombre.toUpperCase()}()`,
      `SELECT 1; SELECT /* x */ ${nombre}()`,
    ]) {
      expect(mencionaContextoDeEmpresa(sql)).toBe(true);
    }
    expect(mencionaContextoDeEmpresa(`SELECT 1 AS x${nombre}`)).toBe(false);
    expect(mencionaContextoDeEmpresa(`SELECT 1 AS ${nombre}_zz`)).toBe(false);
    expect(mencionaContextoDeEmpresa(`SELECT '${nombre}'`)).toBe(false);
  });

  it.each(PREFIJOS)('rechaza todo identificador que empieza con %s', (prefijo) => {
    expect(mencionaContextoDeEmpresa(`SELECT * FROM ${prefijo}vacuum`)).toBe(true);
    expect(mencionaContextoDeEmpresa(`SELECT pg_catalog.${prefijo}x(1)`)).toBe(true);
    expect(mencionaContextoDeEmpresa(`SELECT 1 AS x${prefijo}vacuum`)).toBe(false);
    expect(mencionaContextoDeEmpresa(`SELECT '${prefijo}x'`)).toBe(false);
  });

  it('no rechaza nombres vecinos que sí usa la aplicación', () => {
    expect(mencionaContextoDeEmpresa('SELECT pg_advisory_xact_lock(1)')).toBe(false);
    expect(mencionaContextoDeEmpresa('SELECT now(), clock_timestamp(), gen_random_uuid()')).toBe(
      false,
    );
  });
});
