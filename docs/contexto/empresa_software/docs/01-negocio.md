# 01 – Negocio

## Modelo

- Se alquila el software por **suscripción mensual**; el cliente no compra licencia.
- Precio de entrada: **desde S/ 150/mes** (decisión del 2026-10-19). Planes y límites por definir.
- Objetivo actual: **MVP para empezar a vender**.
- Mercado inicial: **solo Perú**, moneda PEN y precios con IGV incluido. Cobro mensual desde fecha de alta, sin prorrateo automático; pagos parciales con saldo pendiente permitidos.
- La suscripción se compone de base y módulos comerciales compatibles, con límites y precios acordados por contrato. Ejemplos de precios y alcance en el [panel administrativo](05-panel-administrador.md); no son tarifas finales.

## Equipo

| Persona | Rol |
|---|---|
| Fundador | Backend, arquitectura y producto con asistencia de IA; frontend funcional mínimo para entregar versiones |
| Frontend | Principalmente maquetación, diseño y acabado del frontend; integración sobre los contratos acordados |

La [metodología común](../../METODOLOGIA.md) define los roles de IA: GPT-6.1 sol / medio para tareas complejas y GPT-6 luna / máximo para tareas acotadas. La inversión en UI del trabajo con el fundador se limita al recorrido funcional necesario.

## Rubros

| Orden | Rubro | Particularidades |
|---|---|---|
| 1 | Pollería / restaurante | POS rápido, mesas, comandas a cocina, delivery, impresora térmica, offline crítico |
| 1 | Academia de natación | Alumnos, matrículas, horarios, aforo, asistencia (QR), mensualidades |
| Después | Ferretería, botica, cochera, hotel… | Nuevos sistemas independientes, construidos desde cero con sus propios módulos |

Pollería y academia tendrán diseños e implementaciones independientes adecuados a sus reglas. No se construye un núcleo genérico compartido entre ambos.

## Estrategia

- **Se construye un software propio por rubro y se vende por suscripción.** Cada producto se desarrolla desde cero con módulos configurables por empresa, sin CORE compartido.
- Lanzar pocos rubros bien hechos antes de abrir más.

## Precio y alcance de la oferta

La oferta parte de S/ 150 mensuales. Falta definir las prestaciones, límites y costos de soporte de cada plan. Como posibles elementos de valor se consideran:

- Facturación SUNAT como incorporación futura, en la última etapa; su inclusión y límites se definirán entonces.
- Funcionamiento offline real.
- Instalación presencial y configuración de impresoras.
- Soporte rápido por WhatsApp.
- Reportes útiles para el dueño.

El primer MVP no incluye facturación electrónica. Por ahora se desarrolla y prueba todo en local.
