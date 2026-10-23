# Cambios

## 0.3.0 — 2026-10-23

- Carta por local: familias, productos, precios enteros en céntimos PEN, disponibilidad efectiva y ajustes de cantidades con versión, motivo y auditoría.
- Salón: sectores, mesas, mozos habilitados, apertura idempotente y cancelación de atenciones vacías. Protección frente a doble ocupación y cambios durante la atención.
- Migración 004 con RLS, relaciones compuestas y actualización selectiva de permisos; bootstrap y demo reproducible actualizados.
- Interfaz mínima conectada con selección explícita de local. Sin comandas, consumo automático, cobros, impresión ni offline todavía.
- Integración y adversariales en PostgreSQL real, incluido upgrade desde 002 en una BD temporal independiente.

## 0.2.0 — 2026-10-22

- Acceso por empresa, sesiones y contraseñas Argon2id; protección CSRF y límite durable de login.
- PostgreSQL con RLS, relaciones compuestas, runtime restringido y credencial de migración separada. Migraciones 002 y 003, bootstrap explícito con clave oculta y demo opcional reproducible de dos empresas.
- Usuarios, roles/permisos, pertenencias a locales y auditoría; protección del último administrador y de escalaciones mediante roles existentes.
- UI mínima integrada para acceso/administración. Modo local mantiene diagnóstico; sin identidad offline ni ventas.
- Verificación: check completo, 11 pruebas HTTP/políticas, 1 smoke, 12 escenarios de integración PostgreSQL y 11 adversariales independientes; QA de login/contextos/permisos y CLI real. Corregidos logout repetido, CSRF multibyte, carrera del límite de intentos, asignación de roles superiores y validación de UUID malformados.

## 0.1.0 — 2026-10-22

Primera base técnica local de desarrollo, sin release comercial ni despliegue nube.

- Backend HTTP Node.js y exportación estática Next.js, TypeScript y dependencias fijadas.
- Diagnóstico de proceso, acceso denegado hasta implementar autenticación y UI mínima integrada.
- Configuración validada, errores estables y protección de export frente a rutas externas, fuentes, configuración, streams NTFS y junctions hacia contenido privado.
- Alcance propio, decisiones de stack/continuidad, especificación 001 verificada y borrador de acceso multitenant.
- Verificación: tipos/lint/build, 7 contratos, 1 smoke HTTP y QA de navegador con caída/reinicio del backend; revisión independiente sin hallazgos abiertos.

Persistencia, acceso real, mesas, comandas, caja, impresión, KDS y continuidad permanecen pendientes. Facturación electrónica excluida de la primera versión comercial.
