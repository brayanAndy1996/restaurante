import { Body, Controller, Inject, Post } from '@nestjs/common';
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
import { SesionesService } from './sesiones.service';

/** Ingresos del personal (rutas públicas, criterio 1). Lógica en las tareas T12 (contraseña) y T34 (PIN). */
@Controller('sesiones')
export class SesionesController {
  constructor(@Inject(SesionesService) private readonly sesiones: SesionesService) {}

  /**
   * 201 `{ token, sesion }`; 401 `CREDENCIALES_INVALIDAS`; 403 `FUERA_DE_HORARIO`; 429
   * `BLOQUEO_TEMPORAL`. Sin transacción del interceptor (`@Publica()` implica `@SinEmpresa()`): el
   * servicio abre la suya para guardar los fallos aunque responda un error.
   */
  @Post('contrasena')
  @Publica()
  async ingresarConContrasena(
    @Body(new PipeZod(ingresoContrasenaEntradaSchema)) entrada: IngresoContrasenaEntrada,
  ): Promise<IngresoRespuesta> {
    return this.sesiones.ingresarConContrasena(entrada);
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
