# Imagen de la carta web (apps/web, Next.js). El contexto es la RAÍZ del repositorio, porque la carta usa los
# paquetes compartidos (`packages/dominio` y `packages/contratos`):
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.ejemplo.pe \
#     -t restaurante-web .
#
# `NEXT_PUBLIC_API_URL` se incrusta en el JavaScript del navegador al construir. Las demás variables
# (`API_URL_INTERNA`, `CARTA_WEB_URL`, `ARCHIVOS_URL_PUBLICA`) se leen al arrancar el contenedor, salvo
# `ARCHIVOS_URL_PUBLICA`, que Next también necesita al construir para autorizar las imágenes remotas.

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Dependencias: solo las de apps/web y de los paquetes que usa.
FROM base AS dependencias
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contratos/package.json packages/contratos/
COPY packages/dominio/package.json packages/dominio/
RUN pnpm install --frozen-lockfile --filter "@restaurante/web..."

# Construcción: primero los paquetes compartidos y luego la carta.
FROM dependencias AS construccion
ARG NEXT_PUBLIC_API_URL
ARG ARCHIVOS_URL_PUBLICA
ARG CARTA_WEB_URL
# Solo para desarrollo y pruebas (docker-compose.yml): optimizar fotos que salen de una dirección local. En producción
# no se define.
ARG IMAGENES_PERMITIR_IP_LOCAL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    ARCHIVOS_URL_PUBLICA=$ARCHIVOS_URL_PUBLICA \
    CARTA_WEB_URL=$CARTA_WEB_URL \
    IMAGENES_PERMITIR_IP_LOCAL=$IMAGENES_PERMITIR_IP_LOCAL
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter "@restaurante/web^..." build && pnpm --filter "@restaurante/web" build

# Ejecución: solo el servidor autónomo de Next (sharp optimiza las fotos), sin código fuente ni pnpm.
FROM node:22-alpine AS ejecucion
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /repo
RUN addgroup -S carta && adduser -S carta -G carta
COPY --from=construccion --chown=carta:carta /repo/apps/web/.next/standalone ./
COPY --from=construccion --chown=carta:carta /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=construccion --chown=carta:carta /repo/apps/web/public ./apps/web/public
USER carta
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3001/robots.txt >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
