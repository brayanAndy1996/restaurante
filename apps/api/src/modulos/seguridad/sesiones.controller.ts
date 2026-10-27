import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import {
  ingresoContrasenaEntradaSchema,
  ingresoPinEntradaSchema,
  type IngresoContrasenaEntrada,
  type IngresoPinEntrada,
  type IngresoRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Publica } from './decoradores';
import { IngresoPinService } from './ingreso-pin.service';
import { SesionesService } from './sesiones.service';

/** Ingresos del personal (rutas públicas, criterio 1).  */
@Controller('sesiones')
export class SesionesController {
  constructor(
    @Inject(SesionesService) private readonly sesiones: SesionesService,
    @Inject(IngresoPinService) private readonly ingresoPin: IngresoPinService,
  ) {}

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

  /**
   * Exige `X-Equipo`. 201 `{ token, sesion }`; 401 `EQUIPO_NO_RECONOCIDO` / `CREDENCIALES_INVALIDAS`; 403
   * `FUERA_DE_HORARIO`; 429 `BLOQUEO_TEMPORAL`. Sin transacción del interceptor: el servicio abre la suya
   * para guardar los fallos, los bloqueos y el olvido del equipo aunque responda un error.
   */
  @Post('pin')
  @Publica()
  async ingresarConPin(
    @Headers('x-equipo') equipo: string | undefined,
    @Body(new PipeZod(ingresoPinEntradaSchema)) entrada: IngresoPinEntrada,
  ): Promise<IngresoRespuesta> {
    return this.ingresoPin.ingresar(equipo, entrada);
  }
}
