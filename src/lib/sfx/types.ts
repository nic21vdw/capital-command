import type { SfxSettings, SfxSoundId } from "@/types/domain";

// Shared metadata for the viral sound-effect slots. The types live in
// domain.ts (they are part of both the clip and long-form project shapes);
// this module carries the display metadata and defaults both editors use.

export const SFX_SOUND_IDS: SfxSoundId[] = ["vineBoom", "fa", "amongUs"];

export const SFX_SOUNDS: Array<{ id: SfxSoundId; label: string; description: string }> = [
  {
    id: "vineBoom",
    label: "Vine boom",
    description: "Deep bass hit — lands after punchlines and hard statements."
  },
  {
    id: "fa",
    label: "FA",
    description: "Loud brass blast — for shocked, over-the-top moments."
  },
  {
    id: "amongUs",
    label: "Among Us",
    description: "The role-reveal thumps — for sneaky or suspicious lines."
  }
];

export function defaultSfxSettings(): SfxSettings {
  return {
    enabled: false,
    sensitivity: "balanced",
    volume: 0.9,
    sounds: { vineBoom: true, fa: true, amongUs: true }
  };
}

export function isSfxSoundId(value: string): value is SfxSoundId {
  return (SFX_SOUND_IDS as string[]).includes(value);
}
