import type { Turn } from "@/lib/schemas";

export function prepareTurnsForDelivery(turns: Turn[], deliveryEnabled: boolean) {
  if (deliveryEnabled) {
    return turns;
  }

  return turns.map((turn) => ({
    ...turn,
    ttsText: turn.originalText
  }));
}
