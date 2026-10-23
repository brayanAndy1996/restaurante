# Dominios y acceso a los productos

Fecha: 2026-10-19. **Propuesta recomendada para la etapa de nube; pendiente de elegir dominio/proveedor y aprobar el esquema definitivo.** No se ha registrado un dominio ni configurado DNS/HTTPS. La etapa actual sigue siendo local.

## Recomendación

Un dominio principal administrado por la empresa de software y subdominios para el acceso web de cada combinación empresa/producto. No comprar un dominio por cliente por defecto. Usar una estructura de un solo nivel para simplificar DNS y certificados.

Ejemplos ficticios, no dominios contratados:

| Acceso | Ejemplo |
|---|---|
| Sitio comercial | `www.tumarca.pe` |
| Panel interno, si se publica después | `admin.tumarca.pe` |
| Pollería Sol | `sol-polleria.tumarca.pe` |
| Pollería Luna | `luna-polleria.tumarca.pe` |
| Academia Azul | `azul-natacion.tumarca.pe` |

Un subdominio no implica un servidor, despliegue, repositorio ni BD dedicados. El punto de entrada identifica producto y empresa mediante un registro de hosts; el backend sigue comprobando sesión, pertenencia, contrato, licencia/módulos y permisos.

## Comparación

| Opción | Ventaja | Costo o límite | Uso previsto |
|---|---|---|---|
| Host común y empresa por sesión/ruta, como `polleria.tumarca.pe` | Menos gestión de hosts; suficiente para operar multi-tenant | No ofrece URL propia por empresa; necesita igualmente autorización estricta | Alternativa válida si no se necesita dirección personalizada |
| Subdominio por empresa/producto | Dirección propia bajo nuestra marca, automatizable y sin registrar dominios por cliente | Requiere mapeo de hosts, HTTPS y gestión del ciclo de alta/baja | Recomendación para acceso web futuro |
| Dominio independiente por empresa | Identidad comercial separada | Registro/renovación, propiedad, DNS y certificados adicionales | No incluir por defecto |
| Dominio propio del cliente | Permite usar una marca existente | Verificación de titularidad, DNS externo, renovación de certificados y soporte | Adicional futuro, sin precio definido |

## DNS y HTTPS

Puede usarse un registro wildcard para enviar los subdominios al punto de entrada y registros específicos para web/panel u otros servicios. Resolver DNS no da de alta un tenant: los hosts no registrados deben rechazarse. Referencia: [Cloudflare, registros wildcard](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/).

DNS y certificados son configuraciones distintas. Planificar HTTPS y renovación automática; un wildcard TLS `*.tumarca.pe` corresponde al nivel usado en los ejemplos, no al dominio raíz ni a hosts de niveles adicionales como `sol.polleria.tumarca.pe`. Si se utiliza Let's Encrypt para wildcard, su desafío DNS-01 permite la emisión correspondiente. Referencia: [Let's Encrypt, desafíos](https://letsencrypt.org/docs/challenge-types/).

No se elige todavía registrador, DNS/CDN o hosting. Automatizar cuando exista infraestructura, con credenciales de alcance limitado fuera de repositorios, instaladores y la UI del negocio. El panel guarda estado operativo/referencias, no claves DNS expuestas al frontend.

## Vinculación y administración desde el panel, futura

Un registro `TenantHost` asociaría `hostname` único → `tenantId` + `productId` + contrato, con estado, fecha de verificación y situación HTTPS. Un nombre comercial cambiante no reemplaza IDs estables de tenant/producto.

- Alta: reservar un slug único, registrar el host, verificar contrato/producto y publicar el acceso cuando exista despliegue compatible.
- Autorización: normalizar/verificar host; confiar en cabeceras reenviadas solo de proxies configurados. Derivar el tenant del host registrado y exigir que coincida con la identidad autorizada del usuario/instalación.
- Sesiones: limitar cookies al host que las emite y definir CORS/orígenes permitidos. No crear cookies compartidas para todo el dominio ni asumir SSO entre productos.
- Cambio de nombre: mantener trazabilidad y política explícita de alias; no reasignar inmediatamente un hostname usado a otro cliente.
- Mora/cancelación: aplicar política contractual de acceso conservando datos y vías autenticadas de exportación. El DNS no sustituye licencias ni autorización. Evitar destinos DNS abandonados al retirar infraestructura.
- Dominio propio: verificar control antes de asociarlo, emitir HTTPS y retirar la asociación al terminar. No conectar automáticamente el dominio de la web del cliente con sus datos operativos.

Esta gestión es funcionalidad futura del panel, fuera del MVP local. La apariencia sigue configurándose dentro del software del negocio, aunque el hostname lo administre la plataforma.

## Operación local sin internet

Electron en la PC principal abre la aplicación instalada; no necesita un dominio público por empresa. Las terminales LAN acceden al servidor local mediante dirección/nombre de red configurado. Prever reserva de IP, descubrimiento/conexión y el diseño de confianza/HTTPS local en la spec correspondiente; no prometer acceso con solo configurar DNS público.

Los subdominios públicos apuntarán a servicios en nube, no directamente al SQLite ni a puertos abiertos del negocio. El acceso remoto o los reportes web requieren además backend, sincronización y autorización. No publicar el servidor LAN mediante redirección de puertos como solución predeterminada.

La pérdida de internet o el fallo/renovación del dominio público no debe impedir la operación local ya instalada dentro de los límites de su licencia. La continuidad de licencias, internet, DNS y servicio local son asuntos distintos.

## Responsabilidades de la empresa de software

Administrar registro/renovación del dominio de plataforma, DNS, certificados, despliegues, altas/bajas y soporte de sus subdominios. Mantener cuenta de dominio con MFA, responsables y recuperación, renovación/medio de pago vigentes y monitoreo de expiración de dominio/HTTPS al entrar en producción.

Incluir el acceso bajo nuestro subdominio dentro de la oferta estándar cuando exista acceso web. Un dominio independiente/personalizado puede tener costo de configuración y mantenimiento separado, por definir; no prometerlo dentro de S/ 150 sin revisar costos. Si se usa un dominio propiedad del cliente, explicitar su responsabilidad sobre titularidad/renovación y nuestra responsabilidad sobre la integración.
