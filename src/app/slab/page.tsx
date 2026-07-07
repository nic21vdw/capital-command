import { AppShell } from "@/components/layout/app-shell";
import { SlabDesignerPage } from "@/components/slab/slab-designer-page";

export const metadata = {
  title: "Concrete Slab Designer | Nic Vandewetering",
  description: "Flat-plate slab design to CSA A23.3-19 with the Direct Design Method.",
};

export default function Page() {
  return (
    <AppShell>
      <SlabDesignerPage />
    </AppShell>
  );
}
