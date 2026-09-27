"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Download, Plus, Upload } from "lucide-react";
import { makeHolding, useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { Holding } from "@/types/domain";

const assetClasses = ["All", "Stocks", "ETFs", "Crypto", "Cash", "Bonds", "Funds", "REITs", "Other"];
const sortKeys = ["marketValue", "gainLossPercent", "ticker"] as const;

export function HoldingsPage() {
  const { data, summary, mutate } = useAppData();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("All");
  const [assetFilter, setAssetFilter] = useState("All");
  const [sortKey, setSortKey] = useState<"ticker" | "marketValue" | "gainLossPercent">("marketValue");
  const [editing, setEditing] = useState<Holding | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [importPreview, setImportPreview] = useState<Record<string, string>[]>([]);
  const [importError, setImportError] = useState("");

  const accountOptions = ["All", ...Array.from(new Set(data.holdings.map((holding) => holding.account)))];

  useColateralSurface({
    route: "/finance",
    title: "Holdings",
    summary: "Portfolio positions — allocations, cost basis, gains, and manual price overrides.",
    fields: [
      { id: "search", label: "Search holdings", value: search, kind: "text" },
      { id: "accountFilter", label: "Account filter", value: accountFilter, kind: "select", options: accountOptions },
      { id: "assetFilter", label: "Asset class filter", value: assetFilter, kind: "select", options: assetClasses },
      { id: "sortKey", label: "Sort by", value: sortKey, kind: "select", options: [...sortKeys] }
    ],
    controls: [
      { id: "refresh-prices", label: "Refresh prices", group: "Holdings" },
      { id: "add-holding", label: "Add holding", group: "Holdings" }
    ],
    readings: [
      { label: "Holdings tracked", value: String(summary.holdings.length) },
      { label: "Total market value", value: formatCurrency(summary.totalPortfolioValue, data.settings.currency) },
      { label: "Total gain / loss", value: formatCurrency(summary.totalGainLoss, data.settings.currency) }
    ],
    setField: (id, value) => {
      switch (id) {
        case "search":
          if (typeof value !== "string") return false;
          setSearch(value);
          return true;
        case "accountFilter":
          if (typeof value !== "string" || !accountOptions.includes(value)) return false;
          setAccountFilter(value);
          return true;
        case "assetFilter":
          if (typeof value !== "string" || !assetClasses.includes(value)) return false;
          setAssetFilter(value);
          return true;
        case "sortKey":
          if (typeof value !== "string" || !(sortKeys as readonly string[]).includes(value)) return false;
          setSortKey(value as typeof sortKey);
          return true;
        default:
          return false;
      }
    },
    click: (id) => {
      switch (id) {
        case "refresh-prices":
          void mutate("refreshPrices", undefined, { successMessage: "Prices refreshed." });
          return true;
        case "add-holding":
          setEditing(makeHolding());
          setShowModal(true);
          return true;
        default:
          return false;
      }
    }
  });

  const filtered = summary.holdings
    .filter((holding) => {
      if (accountFilter !== "All" && holding.account !== accountFilter) return false;
      if (assetFilter !== "All" && holding.assetClass !== assetFilter) return false;
      const needle = `${holding.ticker} ${holding.name}`.toLowerCase();
      return needle.includes(search.toLowerCase());
    })
    .sort((a, b) => {
      if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker);
      return b[sortKey] - a[sortKey];
    });

  const onImport = (file: File | null) => {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const required = ["ticker", "name", "assetClass", "account", "quantity", "averageCost", "currentPrice", "notes"];
        const headers = result.meta.fields ?? [];
        const missing = required.filter((field) => !headers.includes(field));
        if (missing.length) {
          setImportError(`Missing required columns: ${missing.join(", ")}`);
          setImportPreview([]);
          return;
        }

        setImportError("");
        setImportPreview(result.data);
      }
    });
  };

  const saveHolding = async (formData: FormData) => {
    const item = makeHolding(editing ?? undefined);
    item.ticker = String(formData.get("ticker") ?? "").toUpperCase();
    item.name = String(formData.get("name") ?? "");
    item.assetClass = String(formData.get("assetClass") ?? "Stocks") as Holding["assetClass"];
    item.account = String(formData.get("account") ?? "");
    item.quantity = Number(formData.get("quantity") ?? 0);
    item.averageCost = Number(formData.get("averageCost") ?? 0);
    item.currentPrice = Number(formData.get("currentPrice") ?? 0);
    item.manualPrice = Number(formData.get("manualPrice") ?? 0) || undefined;
    item.dividendYield = Number(formData.get("dividendYield") ?? 0) || undefined;
    item.notes = String(formData.get("notes") ?? "");
    item.updatedAt = new Date().toISOString();
    await mutate("upsertHolding", item, { successMessage: editing ? "Holding updated." : "Holding added." });
    setShowModal(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Holdings"
        title="Portfolio positions"
        description="Track allocations, cost basis, gains, and manual price overrides."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void mutate("refreshPrices", undefined, { successMessage: "Prices refreshed." })}>
              <Download className="mr-2 h-4 w-4" />
              Refresh prices
            </Button>
            <Button
              onClick={() => {
                setEditing(makeHolding());
                setShowModal(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add holding
            </Button>
          </div>
        }
      />
      <Card>
        <div className="grid gap-3 lg:grid-cols-4">
          <Input placeholder="Search holdings" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
            <option>All</option>
            {Array.from(new Set(data.holdings.map((holding) => holding.account))).map((account) => (
              <option key={account}>{account}</option>
            ))}
          </Select>
          <Select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            {assetClasses.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Select>
          <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}>
            <option value="marketValue">Sort by market value</option>
            <option value="gainLossPercent">Sort by gain/loss %</option>
            <option value="ticker">Sort by ticker</option>
          </Select>
        </div>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[var(--muted-foreground)]">
              <tr>
                {["Ticker", "Name", "Asset", "Account", "Qty", "Avg Cost", "Price", "Value", "Gain/Loss", "Weight", "Yield", "Notes", ""].map((label) => (
                  <th key={label} className="border-b border-white/8 px-3 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((holding) => (
                <tr key={holding.id} className="border-b border-white/6">
                  <td className="px-3 py-3 font-medium text-white">{holding.ticker}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.name}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.assetClass}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.account}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.quantity}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatCurrency(holding.averageCost, data.settings.currency)}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatCurrency(holding.resolvedPrice, data.settings.currency)}</td>
                  <td className="px-3 py-3 text-white">{formatCurrency(holding.marketValue, data.settings.currency)}</td>
                  <td className="px-3 py-3">
                    <span className={holding.gainLoss >= 0 ? "tone-success tone-text" : "tone-danger tone-text"}>
                      {formatCurrency(holding.gainLoss, data.settings.currency)} ({formatPercent(holding.gainLossPercent)})
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.portfolioWeight.toFixed(2)}%</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.dividendYield ? `${holding.dividendYield}%` : "-"}</td>
                  <td className="px-3 py-3 text-[var(--muted-foreground)]">{holding.notes ? "Yes" : "-"}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => { setEditing(holding); setShowModal(true); }}>Edit</Button>
                      <Button variant="danger" onClick={() => void mutate("deleteHolding", holding.id, { successMessage: "Holding deleted." })}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">CSV import</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Upload holdings with: ticker, name, assetClass, account, quantity, averageCost, currentPrice, notes
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center rounded-2xl bg-white/6 px-4 py-2 text-sm text-white">
            <Upload className="mr-2 h-4 w-4" />
            Upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={(event) => onImport(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        {importError ? <p className="mt-4 text-sm tone-danger tone-text">{importError}</p> : null}
        {importPreview.length ? (
          <div className="mt-4">
            <div className="overflow-x-auto rounded-2xl border border-white/8">
              <table className="min-w-full text-sm">
                <thead className="bg-white/4 text-[var(--muted-foreground)]">
                  <tr>
                    {Object.keys(importPreview[0] ?? {}).map((header) => (
                      <th key={header} className="px-3 py-2">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 5).map((row, index) => (
                    <tr key={index} className="border-t border-white/8">
                      {Object.values(row).map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 text-[var(--muted-foreground)]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void mutate("importHoldings", importPreview, { successMessage: "Holdings imported." })}>Import rows</Button>
              <Button variant="ghost" onClick={() => setImportPreview([])}>Clear preview</Button>
            </div>
          </div>
        ) : null}
      </Card>
      <Modal
        open={showModal}
        title={editing?.id ? "Edit holding" : "Add holding"}
        description="Manual price override takes precedence when live market data is unavailable."
        onClose={() => { setShowModal(false); setEditing(null); }}
      >
        <form action={saveHolding} className="grid gap-3 md:grid-cols-2">
          <Input name="ticker" placeholder="Ticker" defaultValue={editing?.ticker} required />
          <Input name="name" placeholder="Name" defaultValue={editing?.name} required />
          <Select name="assetClass" defaultValue={editing?.assetClass}>
            {assetClasses.filter((value) => value !== "All").map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Select>
          <Input name="account" placeholder="Account" defaultValue={editing?.account} required />
          <Input name="quantity" type="number" step="any" placeholder="Quantity" defaultValue={editing?.quantity} required />
          <Input name="averageCost" type="number" step="any" placeholder="Average cost" defaultValue={editing?.averageCost} required />
          <Input name="currentPrice" type="number" step="any" placeholder="Current price" defaultValue={editing?.currentPrice} />
          <Input name="manualPrice" type="number" step="any" placeholder="Manual price override" defaultValue={editing?.manualPrice} />
          <Input name="dividendYield" type="number" step="any" placeholder="Dividend yield %" defaultValue={editing?.dividendYield} />
          <div className="md:col-span-2">
            <Textarea name="notes" placeholder="Notes" defaultValue={editing?.notes} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit">Save holding</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
