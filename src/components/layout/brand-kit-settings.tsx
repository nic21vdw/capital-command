"use client";

import { useState, type ReactNode } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveBrandKit, useBrandKitState } from "@/lib/brand/client";
import { BRAND_CHANNELS, type BrandChannel, type BrandKit } from "@/lib/brand/defaults";

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-[var(--muted-foreground)]">
      <span className="mb-2 block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-[var(--border)] p-4">
      <summary className="cursor-pointer font-medium text-white max-sm:py-2">{title}</summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

function ListField({
  label,
  hint,
  value,
  onChange
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <Field label={label} hint={hint}>
      <Textarea
        value={text}
        rows={Math.min(12, Math.max(3, value.length + 1))}
        onChange={(event) => {
          setText(event.target.value);
          onChange(lines(event.target.value));
        }}
      />
    </Field>
  );
}

function BrandKitEditor({
  saved,
  channel,
  setChannel
}: {
  saved: BrandKit;
  channel: BrandChannel;
  setChannel: (channel: BrandChannel) => void;
}) {
  const [draft, setDraft] = useState<BrandKit>(saved);
  const [revision, setRevision] = useState(0);
  const { busy } = useBrandKitState();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const config = draft.channels[channel];

  const change = (edit: (next: BrandKit) => void) =>
    setDraft((current) => {
      const next = structuredClone(current);
      edit(next);
      return next;
    });

  const save = async () => {
    if (await saveBrandKit(draft)) toast.success("Brand kit saved.");
  };

  return (
    <div className="mt-5 space-y-3">
      <div key={revision} className="space-y-3">
        <Section title="Who it speaks for">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={draft.identity.name} onChange={(event) => change((next) => (next.identity.name = event.target.value))} />
            </Field>
            <Field label="First name" hint="Used wherever a prompt says who it is working for.">
              <Input
                value={draft.identity.firstName}
                onChange={(event) => change((next) => (next.identity.firstName = event.target.value))}
              />
            </Field>
            <Field label="Handle">
              <Input
                value={draft.identity.handle}
                onChange={(event) => change((next) => (next.identity.handle = event.target.value))}
                placeholder="@you"
              />
            </Field>
            <Field label="Role">
              <Input value={draft.identity.role} onChange={(event) => change((next) => (next.identity.role = event.target.value))} />
            </Field>
            <Field label="Website">
              <Input value={draft.links.site} onChange={(event) => change((next) => (next.links.site = event.target.value))} />
            </Field>
            <Field label="YouTube channel link">
              <Input value={draft.links.youtube} onChange={(event) => change((next) => (next.links.youtube = event.target.value))} />
            </Field>
            <Field label="X profile link">
              <Input value={draft.links.x} onChange={(event) => change((next) => (next.links.x = event.target.value))} />
            </Field>
          </div>
        </Section>

        <Section title="What it says about the product">
          <Field label="One-liner">
            <Textarea
              value={draft.positioning.oneLiner}
              onChange={(event) => change((next) => (next.positioning.oneLiner = event.target.value))}
            />
          </Field>
          <Field label="Description" hint="Put in front of every generator as who is speaking and what the product is.">
            <Textarea
              value={draft.positioning.description}
              onChange={(event) => change((next) => (next.positioning.description = event.target.value))}
            />
          </Field>
          <Field label="Tagline">
            <Input
              value={draft.positioning.tagline}
              onChange={(event) => change((next) => (next.positioning.tagline = event.target.value))}
            />
          </Field>
          <ListField
            label="Channel keywords"
            hint="One per line. Worked in only where the content supports them."
            value={draft.vocabulary.keywords}
            onChange={(keywords) => change((next) => (next.vocabulary.keywords = keywords))}
          />
        </Section>

        <Section title="Voice and banned words">
          <ListField
            label="Voice rules"
            hint="One per line. Every AI generator is given these."
            value={draft.voice.rules}
            onChange={(rules) => change((next) => (next.voice.rules = rules))}
          />
          <ListField
            label="Words and phrases never to use"
            hint="One per line."
            value={draft.voice.bannedPhrases}
            onChange={(phrases) => change((next) => (next.voice.bannedPhrases = phrases))}
          />
          <ListField
            label="Claims never to make"
            hint="One per line."
            value={draft.voice.bannedClaims}
            onChange={(claims) => change((next) => (next.voice.bannedClaims = claims))}
          />
          <Field label="Em and en dashes" hint="Strip turns a dash into a comma in every generated caption and post.">
            <Select
              value={draft.voice.dashes}
              onChange={(event) => change((next) => (next.voice.dashes = event.target.value as "strip" | "allow"))}
            >
              <option value="strip">Strip</option>
              <option value="allow">Allow</option>
            </Select>
          </Field>
        </Section>

        <Section title="Each channel">
          <Field label="Channel">
            <Select value={channel} onChange={(event) => setChannel(event.target.value as BrandChannel)}>
              {BRAND_CHANNELS.map((id) => (
                <option key={id} value={id}>
                  {draft.channels[id].label}
                </option>
              ))}
            </Select>
          </Field>
          <div key={channel} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Call to action">
                <Input
                  value={config.cta.line}
                  onChange={(event) => change((next) => (next.channels[channel].cta.line = event.target.value))}
                />
              </Field>
              <Field label="Link">
                <Input
                  value={config.cta.url}
                  onChange={(event) => change((next) => (next.channels[channel].cta.url = event.target.value))}
                />
              </Field>
              <Field label="Hashtags to aim for" hint="0 means none on this channel.">
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={config.hashtags.target}
                  onChange={(event) => change((next) => (next.channels[channel].hashtags.target = Number(event.target.value) || 0))}
                />
              </Field>
              <Field label="Hashtags at most">
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={config.hashtags.max}
                  onChange={(event) => change((next) => (next.channels[channel].hashtags.max = Number(event.target.value) || 0))}
                />
              </Field>
              <Field label="Emoji">
                <Select
                  value={config.emoji}
                  onChange={(event) =>
                    change((next) => (next.channels[channel].emoji = event.target.value as "none" | "sparing" | "allowed"))
                  }
                >
                  <option value="none">None</option>
                  <option value="sparing">Sparing</option>
                  <option value="allowed">Allowed</option>
                </Select>
              </Field>
            </div>
            <Field label="How this channel reads">
              <Textarea value={config.guide} onChange={(event) => change((next) => (next.channels[channel].guide = event.target.value))} />
            </Field>
            <ListField
              label="Always include these hashtags"
              value={config.hashtags.base}
              onChange={(base) => change((next) => (next.channels[channel].hashtags.base = base))}
            />
            <ListField
              label="Extra words to avoid here"
              hint="One per line."
              value={config.avoid}
              onChange={(avoid) => change((next) => (next.channels[channel].avoid = avoid))}
            />
            <ListField
              label="Extra rules for this channel"
              hint="One per line."
              value={config.rules}
              onChange={(rules) => change((next) => (next.channels[channel].rules = rules))}
            />
          </div>
        </Section>

        <Section title="Carousel signature">
          <p className="text-xs text-[var(--muted-foreground)]">
            Drawn at the foot of every carousel slide. The layout is fixed; only the words change. Leave both blank and carousels go out
            unsigned.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={draft.carousel.signature.name}
                onChange={(event) => change((next) => (next.carousel.signature.name = event.target.value))}
              />
            </Field>
            <Field label="Handle">
              <Input
                value={draft.carousel.signature.handle}
                onChange={(event) => change((next) => (next.carousel.signature.handle = event.target.value))}
                placeholder="@you"
              />
            </Field>
          </div>
        </Section>

        <Section title="Colours and logo">
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(draft.palette) as Array<keyof BrandKit["palette"]>).map((key) => (
              <Field key={key} label={key}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-9 w-9 shrink-0 rounded-lg border border-white/10"
                    style={{ background: draft.palette[key] }}
                    aria-hidden="true"
                  />
                  <Input value={draft.palette[key]} onChange={(event) => change((next) => (next.palette[key] = event.target.value))} />
                </div>
              </Field>
            ))}
            <Field label="Logo path">
              <Input value={draft.logo.path} onChange={(event) => change((next) => (next.logo.path = event.target.value))} />
            </Field>
          </div>
        </Section>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={() => void save()} disabled={!dirty || busy}>
          Save brand kit
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(saved);
            setRevision((current) => current + 1);
          }}
          disabled={!dirty || busy}
        >
          Discard changes
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Reset the brand kit to its defaults? Every change saved here is discarded.")) {
              void saveBrandKit({}).then((ok) => ok && toast.success("Brand kit reset to its defaults."));
            }
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

export function BrandKitSettings() {
  const { kit, loaded, error, issues, overrides } = useBrandKitState();
  const [channel, setChannel] = useState<BrandChannel>("youtube");
  const changes = Object.keys(overrides).length;
  return (
    <Card id="brand-kit" className="scroll-mt-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
          <Megaphone className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Brand kit</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            One voice for every caption, post and prompt: who it speaks for, the words it never uses, the links and hashtags for each
            channel.
            {changes === 0 ? " Showing the defaults." : " Your changes are saved on this machine."}
          </p>
        </div>
      </div>
      {error ? <p className="mt-3 text-xs text-amber-200">{error}</p> : null}
      {issues.length > 0 ? <p className="mt-3 text-xs text-amber-200">{issues.join(" ")}</p> : null}
      {loaded ? (
        <BrandKitEditor key={JSON.stringify(kit)} saved={kit} channel={channel} setChannel={setChannel} />
      ) : (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">Loading…</p>
      )}
    </Card>
  );
}
