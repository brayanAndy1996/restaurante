import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';

/**
 * Dice cuáles de las mesas tienen una orden abierta. Lo implementa quien sea dueño de las órdenes (el módulo de
 * pedidos): `salon` no puede consultar esas tablas ni importar ese módulo (el mapa con estados vive en pedidos,
 * así no hay ciclo).
 */
export type ComprobadorDeMesasEnUso = (
  mesaIds: readonly string[],
  transaccion?: Transaction,
) => Promise<readonly string[]>;

/**
 * Punto de enganche entre el mapa de mesas y las órdenes (criterio 4): desactivar una mesa con orden abierta
 * responde 409 `EN_USO`. Mientras ningún módulo registre su comprobador (antes de que existan las órdenes) ninguna
 * mesa está en uso. `PedidosModule` registra el suyo al arrancar con `registrar`.
 */
@Injectable()
export class UsoDeMesas {
  private readonly comprobadores: ComprobadorDeMesasEnUso[] = [];

  /** Suma un comprobador; se consultan todos y se unen sus resultados. */
  registrar(comprobador: ComprobadorDeMesasEnUso): void {
    this.comprobadores.push(comprobador);
  }

  /** Los ids (de `mesaIds`) que tienen una orden abierta. */
  async conOrdenAbierta(
    mesaIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<Set<string>> {
    const enUso = new Set<string>();
    if (mesaIds.length === 0) return enUso;
    for (const comprobador of this.comprobadores) {
      for (const id of await comprobador(mesaIds, transaccion)) enUso.add(id);
    }
    return enUso;
  }
}
