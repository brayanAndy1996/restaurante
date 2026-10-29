// El `ETag` de las vistas con `If-None-Match` vive en el núcleo desde la historia 004 (`GET /salon` y el KDS lo
// comparten); la carta lo reexporta para no cambiar sus importaciones ni sus pruebas.
export { coincideConEtag, etagDeVista, jsonCanonico } from '../../nucleo/http/etag';
