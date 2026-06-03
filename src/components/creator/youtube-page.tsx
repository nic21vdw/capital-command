"use client";

import { NotebookText, Youtube } from "lucide-react";
import { CreatorPage } from "@/components/creator/creator-page";
import { NotesPage } from "@/components/notes/notes-page";
import { Tabs } from "@/components/ui/tabs";

export function YouTubePage() {
  return (
    <Tabs
      tabs={[
        { id: "studio", label: "Creator Studio", icon: Youtube, content: <CreatorPage /> },
        { id: "notes", label: "Research Notes", icon: NotebookText, content: <NotesPage /> }
      ]}
    />
  );
}
