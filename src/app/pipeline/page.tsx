import { redirect } from "next/navigation";

/**
 * The Stream Pipeline moved to `/` — it is the app's front door, not one tab
 * among many. This route stays so existing bookmarks and the deep links other
 * pages already emit keep landing in the right place.
 */
export default function Page() {
  redirect("/");
}
