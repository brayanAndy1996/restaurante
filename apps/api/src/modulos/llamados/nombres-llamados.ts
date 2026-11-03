import { Inject, Injectable } from '@nestjs/common';
import { MesasConsultaService } from '../salon';
import { UsuariosConsultaService } from '../seguridad';
import type { FilaLlamado } from './filas-llamado';

/**
 * Los nombres que acompañan a los llamados del mozo (historia 005, criterios 39 y 40): las personas que los atendieron
 * o cerraron (`UsuariosConsultaService`, seguridad) y las mesas (`MesasConsultaService`, salón). Una consulta de cada
 * una sin importar cuántos llamados haya; el módulo de llamados nunca consulta `usuario` ni `mesa`.
 */
@Injectable()
export class NombresDeLlamados {
  constructor(
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
  ) {}

  async de(
    filas: readonly FilaLlamado[],
  ): Promise<{ usuarios: Map<string, string>; mesas: Map<string, string> }> {
    const personas = filas.flatMap((f) =>
      [f.atendido_por_usuario_id, f.cerrado_por_usuario_id].filter(
        (id): id is string => id !== null,
      ),
    );
    return {
      usuarios: await this.usuarios.nombres(personas),
      mesas: await this.mesas.nombres(filas.map((f) => f.mesa_id)),
    };
  }
}
