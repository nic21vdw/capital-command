import { SOURCE_LABELS, type ListeningResult } from "@/lib/listening/model";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { mergeContacts, normalizeContactUrl, type OutreachContactInput } from "@/lib/outreach/model";
import { updateOutreachStore } from "@/lib/outreach/store";

const ANGLE = "Answer what they asked in the thread first. Say you built CoLateral before you mention it, and only if it genuinely helps.";

function contactFor(hit: ListeningResult): OutreachContactInput {
  const label = SOURCE_LABELS[hit.source];
  return {
    name: hit.author ? `${hit.author} on ${label}` : `A ${label} post`,
    url: hit.url,
    platform: hit.source === "youtube" ? "youtube" : hit.source === "x" ? "x" : "other",
    fit: hit.reason ? `${hit.reason} (score ${hit.score})` : hit.title,
    angle: ANGLE,
    notes: [hit.title, hit.excerpt, `Matched: ${hit.matchedTerms.join(", ")}`, `Found on ${label}`].filter(Boolean).join("\n"),
    status: "to-contact",
    recentVideo: hit.source === "youtube" ? { title: hit.title, url: hit.url } : undefined
  };
}

export async function sendHitToOutreach(resultId: string): Promise<{ contactId: string; created: boolean }> {
  const hit = (await readListeningStore()).results.find((result) => result.id === resultId);
  if (!hit) throw new Error("No result with that id.");

  const key = normalizeContactUrl(hit.url);
  let contactId = "";
  let created = false;
  await updateOutreachStore((outreach) => {
    const known = outreach.contacts.find((contact) => normalizeContactUrl(contact.url) === key);
    if (known) {
      contactId = known.id;
      return outreach;
    }
    const merged = mergeContacts(outreach.contacts, [contactFor(hit)]);
    contactId = merged.contacts.find((contact) => normalizeContactUrl(contact.url) === key)?.id ?? "";
    created = true;
    return { ...outreach, contacts: merged.contacts };
  });
  if (!contactId) throw new Error("The outreach contact could not be created.");

  await updateListeningStore((current) => ({
    ...current,
    results: current.results.map((result) => (result.id === resultId ? { ...result, status: "sent-to-outreach" as const, outreachContactId: contactId } : result))
  }));
  return { contactId, created };
}
