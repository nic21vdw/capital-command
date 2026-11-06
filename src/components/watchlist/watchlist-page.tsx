"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { makeWatchlistItem, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import type { WatchlistItem } from "@/types/domain";

export function WatchlistPage() {
  const { data, mutate } = useAppData();
  const [riskFilter, setRiskFilter] = useState("All");
  const [convictionFilter, setConvictionFilter] = useState("All");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [showModal, setShowModal] = useState(false);

  const filtered = data.watchlist.filter((item) => {
    if (riskFilter !== "All" && String(item.riskRating) !== riskFilter) return false;
    if (convictionFilter !== "All" && String(item.convictionRating) !== convictionFilter) return false;
    return true;
  });

  const saveItem = async (formData: FormData) => {
    const item = makeWatchlistItem(editing ?? undefined);
    item.ticker = String(formData.get("ticker") ?? "").toUpperCase();
    item.name = String(formData.get("name") ?? "");
    item.assetClass = String(formData.get("assetClass") ?? "Stocks") as WatchlistItem["assetClass"];
    item.currentPrice = Number(formData.get("currentPrice") ?? 0) || undefined;
    item.targetBuyPrice = Number(formData.get("targetBuyPrice") ?? 0) || undefined;
    item.reason = String(formData.get("reason") ?? "");
    item.riskRating = Number(formData.get("riskRating") ?? 3);
    item.convictionRating = Number(formData.get("convictionRating") ?? 3);
    item.notes = String(formData.get("notes") ?? "");
    await mutate("upsertWatchlistItem", item, { successMessage: editing ? "Watchlist item updated." : "Watchlist item added." });
    setShowModal(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Watchlist"
        title="Watchlist"
        description="Track potential positions with target prices and reasons."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setView(view === "cards" ? "table" : "cards")}>
              View: {view === "cards" ? "Cards" : "Table"}
            </Button>
            <Button onClick={() => { setEditing(makeWatchlistItem()); setShowModal(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Add item
            </Button>
          </div>
        }
      />
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
            <option>All</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
          </Select>
          <Select value={convictionFilter} onChange={(event) => setConvictionFilter(event.target.value)}>
            <option>All</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
          </Select>
        </div>
      </Card>
      {view === "cards" ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-white">{item.ticker}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{item.name}</p>
                </div>
                <Badge>{item.assetClass}</Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <p className="text-[var(--muted-foreground)]">Current price: <span className="text-white">{formatCurrency(item.currentPrice ?? 0, data.settings.currency)}</span></p>
                <p className="text-[var(--muted-foreground)]">Target buy price: <span className="text-white">{formatCurrency(item.targetBuyPrice ?? 0, data.settings.currency)}</span></p>
                <p className="text-[var(--muted-foreground)]">{item.reason}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Risk {item.riskRating}/5</Badge>
                <Badge>Conviction {item.convictionRating}/5</Badge>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void mutate("moveWatchlistToHolding", item, { successMessage: "Moved into holdings." })}>
                  Move to holdings
                </Button>
                <Button variant="ghost" onClick={() => { setEditing(item); setShowModal(true); }}>Edit</Button>
                <Button variant="danger" onClick={() => void mutate("deleteWatchlistItem", item.id, { successMessage: "Watchlist item deleted." })}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[var(--muted-foreground)]">
                <tr>
                  {["Ticker", "Name", "Current", "Target", "Reason", "Risk", "Conviction", "Date added", ""].map((label) => (
                    <th key={label} className="border-b border-white/8 px-3 py-3">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-white/6">
                    <td className="px-3 py-3 font-medium text-white">{item.ticker}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{item.name}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatCurrency(item.currentPrice ?? 0, data.settings.currency)}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatCurrency(item.targetBuyPrice ?? 0, data.settings.currency)}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{item.reason}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{item.riskRating}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{item.convictionRating}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{new Date(item.dateAdded).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => void mutate("moveWatchlistToHolding", item, { successMessage: "Moved into holdings." })}>Move</Button>
                        <Button variant="ghost" onClick={() => { setEditing(item); setShowModal(true); }}>Edit</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Modal open={showModal} title={editing?.id ? "Edit watchlist item" : "Add watchlist item"} onClose={() => { setShowModal(false); setEditing(null); }}>
        <form action={saveItem} className="grid gap-3 md:grid-cols-2">
          <Input name="ticker" placeholder="Ticker" defaultValue={editing?.ticker} required />
          <Input name="name" placeholder="Name" defaultValue={editing?.name} required />
          <Select name="assetClass" defaultValue={editing?.assetClass}>
            {["Stocks", "ETFs", "Crypto", "Cash", "Bonds", "Funds", "REITs", "Other"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Select>
          <Input name="currentPrice" type="number" step="any" placeholder="Current price" defaultValue={editing?.currentPrice} />
          <Input name="targetBuyPrice" type="number" step="any" placeholder="Target buy price" defaultValue={editing?.targetBuyPrice} />
          <Input name="riskRating" type="number" min="1" max="5" placeholder="Risk 1-5" defaultValue={editing?.riskRating} required />
          <Input name="convictionRating" type="number" min="1" max="5" placeholder="Conviction 1-5" defaultValue={editing?.convictionRating} required />
          <div className="md:col-span-2">
            <Textarea name="reason" placeholder="Reason for watching" defaultValue={editing?.reason} required />
          </div>
          <div className="md:col-span-2">
            <Textarea name="notes" placeholder="Notes" defaultValue={editing?.notes} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit">Save item</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
