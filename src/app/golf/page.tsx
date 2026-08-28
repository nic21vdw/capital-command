import { redirect } from "next/navigation";

export const metadata = {
  title: "Clip Generator | Capital Command",
  description: "Turn long YouTube streams into short clips."
};

export default function GolfPage() {
  redirect("/clips");
}
