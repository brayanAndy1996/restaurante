import { Body, Controller, Post } from '@nestjs/common';
import {
  ingresoContrasenaEntradaSchema,
  ingresoPinEntradaSchema,
  type IngresoContrasenaEntrada,
  type IngresoPinEntrada,
  type IngresoRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Publica } from './decoradores';

/** Ingresos del personal (rutas públicas, criterio 1). Lógica en las tareas T12 (contraseña) y T34 (PIN). */
@Controller('sesiones')
export class SesionesController {
  /** 201 `{ token, sesion }`; 401 `CREDENCIALES_INVALIDAS`; 403 `FUERA_DE_HORARIO`; 429 `BLOQUEO_TEMPORAL`. */
  @Post('contrasena')
  @Publica()
  async ingresarConContrasena(
    @Body(new PipeZod(ingresoContrasenaEntradaSchema)) _entrada: IngresoContrasenaEntrada,
  ): Promise<IngresoRespuesta> {
    return noImplementado();
  }

  /** Exige `X-Equipo`. 201 `{ token, sesion }`; 401 `EQUIPO_NO_RECONOCIDO` / `CREDENCIALES_INVALIDAS`; 403; 429. */
  @Post('pin')
  @Publica()
  async ingresarConPin(
    @Body(new PipeZod(ingresoPinEntradaSchema)) _entrada: IngresoPinEntrada,
  ): Promise<IngresoRespuesta> {
    return noImplementado();
  }
}
