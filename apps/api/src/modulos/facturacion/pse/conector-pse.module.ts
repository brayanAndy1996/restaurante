import { DynamicModule, Global, Module } from '@nestjs/common';
import { CONECTOR_PSE, type ConectorPse } from './conector-pse';
import { SimuladorPse } from './simulador-pse';

/**
 * Provee `CONECTOR_PSE`, el **simulador** del proceso, a toda la aplicación (historia 006, entrega 6b, criterio 122).
 * `crearAplicacion({ pse })` instala el de la prueba (un `SimuladorPse` con sus reglas) y reemplaza solo al simulador: lo usan
 * los emisores `SIMULADO`. Un emisor `REAL` nunca lo usa: `RegistroDeConectores` busca su adaptador en `ADAPTADORES_REALES`.
 * Una instancia por aplicación.
 */
@Global()
@Module({})
export class ConectorPseModule {
  static registrar(pse?: ConectorPse): DynamicModule {
    return {
      module: ConectorPseModule,
      providers: [{ provide: CONECTOR_PSE, useValue: pse ?? new SimuladorPse() }],
      exports: [CONECTOR_PSE],
    };
  }
}
