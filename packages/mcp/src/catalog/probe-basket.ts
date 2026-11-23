import type { CompareLine } from './compare.js';

/**
 * Postal code this basket was checked against.
 * Día regional lookup, sales channel 1, region U1cjYXJkaWFwcm9kMTA4MA==.
 */
export const PROBE_POSTAL = '1414';

/**
 * Fixed Día basket for the Workers compare probe.
 * Checked 2026-11-22: each sku is returned by `sku:<id>` at postal code 1414.
 * 38576 (Matarazzo spaghetti) is not sold to 1414 and is not here.
 * Shelf prices are centavos at that check. The probe does not return them.
 * The Día house-brand oil and the Favorita flour are the lines most likely
 * to miss an EAN hit, so the match rate is not trivially 1.
 */
export const PROBE_BASKET: readonly CompareLine[] = [
  { skuId: '165870', name: 'Leche Entera Clasica La Serenísima Botella Larga Vida 1 Lt.', quantity: 1, lineTotal: { centavos: 318_000 } },
  { skuId: '269577', name: 'Yerba Mate Playadito Suave 1 Kg.', quantity: 1, lineTotal: { centavos: 520_800 } },
  { skuId: '40877', name: 'Fideos Spaghetti N7 Luchetti 500 Gr.', quantity: 2, lineTotal: { centavos: 277_500 } },
  { skuId: '295459', name: 'Arroz Parboil Gallo 1 Kg.', quantity: 1, lineTotal: { centavos: 324_800 } },
  { skuId: '48604', name: 'Aceite de Girasol Cañuelas 900 Ml.', quantity: 1, lineTotal: { centavos: 440_000 } },
  { skuId: '129208', name: 'Azúcar Ledesma Refinado Superior 1 Kg.', quantity: 1, lineTotal: { centavos: 163_500 } },
  { skuId: '309267', name: 'Cafe Molido Tostado La Virginia 250 Gr.', quantity: 1, lineTotal: { centavos: 945_000 } },
  { skuId: '300780', name: 'Harina 000 con Vitaminas Favorita 1 Kg.', quantity: 1, lineTotal: { centavos: 97_500 } },
  { skuId: '14797', name: 'Atún al Natural La Campagnola 170 Gr.', quantity: 1, lineTotal: { centavos: 627_800 } },
  { skuId: '15128', name: 'Lavandina Ayudín Original 1 Lt.', quantity: 1, lineTotal: { centavos: 139_000 } },
  { skuId: '271630', name: 'Galletitas Oreo Rellenas con Crema Sabor Original 354 Gr.', quantity: 1, lineTotal: { centavos: 389_000 } },
  { skuId: '14938', name: 'Manteca La Serenísima 200 Gr.', quantity: 1, lineTotal: { centavos: 390_000 } },
  { skuId: '298974', name: 'Agua Sin Gas Villavicencio 2 Lt.', quantity: 2, lineTotal: { centavos: 420_000 } },
  { skuId: '269666', name: 'Yerba Mate Taragüi 4 Flex 1 Kg.', quantity: 1, lineTotal: { centavos: 379_000 } },
  { skuId: '226068', name: 'Aceite de Girasol Dia 900 Ml.', quantity: 1, lineTotal: { centavos: 364_500 } },
];
