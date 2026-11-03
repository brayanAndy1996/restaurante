import { Injectable } from '@nestjs/common';

/** El código de una mesa tal como se guarda en `mesa_qr` (historia 005, criterio 6). */
export interface CodigoDeMesa {
  mesaId: string;
  /** 22 caracteres base64url (`CODIGO_MESA_REGEX`). */
  codigo: string;
  generadoEn: Date;
}

/** La mesa a la que lleva un código, vista dentro del contexto de su empresa (criterios 10 y 14). */
export interface MesaDeCodigo {
  mesaId: string;
  nombre: string;
  sucursalId: string;
  /** Una mesa inactiva no responde en las rutas públicas. */
  activa: boolean;
}

/**
 * Códigos QR de las mesas (historia 005, criterios 6 a 10): dueño de `mesa_qr` (la identidad pública de cada mesa).
 * Los demás módulos lo usan por este servicio, nunca consultando la tabla. Corre en la transacción de la empresa
 * del contexto activo. FIRMAS: la implementación llega en la fase C (T5 y T10).
 */
@Injectable()
export class CodigosMesaService {
  /**
   * Crea el código de una mesa (16 bytes de `crypto.randomBytes` en base64url) en la transacción actual. Lo llaman
   * `MesasService.crear` y `crearFaltantes`. Un choque con el espejo (prácticamente imposible) reintenta una vez y,
   * si vuelve a fallar, 409 `CONFLICTO`.
   */
  async crearPara(mesaId: string): Promise<CodigoDeMesa> {
    void mesaId;
    throw new Error('No implementado');
  }

  /**
   * Crea el código de cada mesa activa de la sucursal que no lo tenga y devuelve cuántos creó (criterio 8). Repetirlo
   * no cambia ningún código.
   */
  async crearFaltantes(sucursalId: string): Promise<number> {
    void sucursalId;
    throw new Error('No implementado');
  }

  /**
   * Cambia el código de la mesa por uno nuevo, bloqueando su fila de `mesa_qr` (`FOR UPDATE`); desde que se
   * confirma, el anterior no se encuentra (criterio 9).
   */
  async cambiar(mesaId: string): Promise<CodigoDeMesa> {
    void mesaId;
    throw new Error('No implementado');
  }

  /**
   * La mesa de un código bajo la RLS de la empresa del contexto (mesa unida a `mesa_qr`), o `null` si el código no
   * existe en esta empresa. Devuelve también las mesas inactivas: quien llama responde 404 si `activa` es `false`.
   * La empresa del código se busca antes y fuera del contexto con `buscarEmpresaDeCodigoMesa`.
   */
  async resolver(codigo: string): Promise<MesaDeCodigo | null> {
    void codigo;
    throw new Error('No implementado');
  }

  /**
   * Lo mismo que `resolver`, bloqueando la fila de `mesa_qr` con `FOR UPDATE`: serializa los llamados de la misma
   * mesa (criterio 30).
   */
  async bloquearPorCodigo(codigo: string): Promise<MesaDeCodigo | null> {
    void codigo;
    throw new Error('No implementado');
  }
}
