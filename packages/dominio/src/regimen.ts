/** Régimen tributario del emisor; define qué comprobantes puede emitir (RF-65, historia de facturación). */
export const REGIMENES_TRIBUTARIOS = ['NUEVO_RUS', 'RER', 'MYPE_TRIBUTARIO', 'GENERAL'] as const;

export type RegimenTributario = (typeof REGIMENES_TRIBUTARIOS)[number];
