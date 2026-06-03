"use client";

import { KanbanSquare, NotebookText, Youtube } from "lucide-react";
import { CreatorPage } from "@/components/creator/creator-page";
import { YouTubeStudioPage } from "@/components/creator/youtube-studio-page";
import { NotesPage } from "@/components/notes/notes-page";
import { Tabs } from "@/components/ui/tabs";

export function YouTubePage() {
  return (
    <Tabs
      tabs={[
        { id: "studio", label: "Studio", icon: Youtube, content: <YouTubeStudioPage /> },
        { id: "pipeline", label: "Pipeline", icon: KanbanSquare, content: <CreatorPage /> },
        { id: "notes", label: "Research Notes", icon: NotebookText, content: <NotesPage /> }
      ]}
    />
  );
}
