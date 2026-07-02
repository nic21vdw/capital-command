import { redirect } from "next/navigation";

export const metadata = {
  title: "Clip Generator | Nic Vandewetering",
  description: "Turn long YouTube streams into short clips."
};

export default function Page() {
  redirect("/clips");
}
