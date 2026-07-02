import type { CaptionSegment, ClipProject, Overlay, OverlayKind } from "@/types/domain";

export type ExportUiState = {
  status: "idle" | "starting" | "processing" | "done" | "error";
  progress: number;
  exportId?: string;
  file?: string;
  error?: string;
};

/** The full set of actions the editor panels operate through. */
export interface EditorApi {
  project: ClipProject;
  time: number;
  seek: (t: number) => void;
  patch: (partial: Partial<ClipProject>) => void;
  setTrim: (start: number, end: number) => void;
  generateTitle: () => void;

  // Captions
  fetchingCaptions: boolean;
  regenerateCaptions: () => void;
  addCaption: () => void;
  updateCaption: (id: string, partial: Partial<CaptionSegment>) => void;
  deleteCaption: (id: string) => void;
  splitCaption: (id: string) => void;
  mergeCaptionWithNext: (id: string) => void;
  toggleCaption: (id: string) => void;
  selectedCaptionId: string | null;
  setSelectedCaptionId: (id: string | null) => void;

  // Overlays
  addOverlay: (kind: OverlayKind, src?: string) => void;
  updateOverlay: (id: string, partial: Partial<Overlay>) => void;
  deleteOverlay: (id: string) => void;
  duplicateOverlay: (id: string) => void;
  reorderOverlay: (id: string, direction: "up" | "down") => void;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;

  // Export
  exportState: ExportUiState;
  runExport: () => void;
  downloadSubtitles: (format: "srt" | "vtt") => void;
}
