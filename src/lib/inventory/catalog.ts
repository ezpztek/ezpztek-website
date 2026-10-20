export const inventoryUnits = [
  { value: "piece", label: "Piece" },
  { value: "pack", label: "Pack" },
  { value: "box", label: "Box" },
  { value: "bundle", label: "Bundle" },
  { value: "ml", label: "mL" },
  { value: "grams", label: "Grams" },
] as const;

export type InventoryUnit = (typeof inventoryUnits)[number]["value"];

export const inventoryUnitValues = inventoryUnits.map((unit) => unit.value) as [
  InventoryUnit,
  ...InventoryUnit[],
];

export function inventoryUnitLabel(value: string) {
  return inventoryUnits.find((unit) => unit.value === value)?.label ?? value;
}

export function isGeneratedInventorySku(value: string) {
  return /^AUTO-[0-9A-F]{32}$/.test(value);
}
