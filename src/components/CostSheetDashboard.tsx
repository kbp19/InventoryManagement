"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  fetchCostSheetData,
  fetchInvoiceTotalCount,
  fetchEntityHistory,
  EnrichedRow,
} from "@/lib/costsheet";
import * as XLSX from "xlsx";
import { signOut } from "next-auth/react";
import Link from "next/link";

const BITRIX_USER_ID = process.env.NEXT_PUBLIC_BITRIX_USER_ID || "";
const BITRIX_HOOK_SECRET = process.env.NEXT_PUBLIC_BITRIX_HOOK_SECRET || "";

// ─── IST Date Helpers ────────────────────────────────────────────────────────

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 - now.getTimezoneOffset()) * 60000);
  return ist.toISOString().split("T")[0];
}

function firstOfMonthIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 - now.getTimezoneOffset()) * 60000);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toISTString(dateStr: string, endOfDay: boolean = false): string {
  if (endOfDay) {
    return `${dateStr}T23:59:59+05:30`;
  }
  return `${dateStr}T00:00:00+05:30`;
}

function formatISTDate(isoString: string): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return isoString;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

type SortKey = "createdTime" | "totalAmount" | "patientName" | "counselorName" | "dealTitle";
type SortDir = "asc" | "desc";

// ─── Searchable Dropdown ─────────────────────────────────────────────────────

function SearchableDropdown({
  options,
  selectedValues,
  onChange,
  disabled,
  placeholder,
}: {
  options: string[];
  selectedValues: string[];
  onChange: (val: string[]) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggleOption = (opt: string) => {
    if (selectedValues.includes(opt)) {
      onChange(selectedValues.filter(v => v !== opt));
    } else {
      onChange([...selectedValues, opt]);
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        className={`w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-[#CBD5E1] bg-white flex flex-wrap items-center gap-1.5 transition-all ${
          disabled ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "text-[#1E293B] cursor-pointer hover:border-[#3B82F6]"
        }`}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearch("");
          }
        }}
      >
        {selectedValues.length === 0 ? (
          <span className="text-[#94A3B8] px-1 py-0.5">{placeholder}</span>
        ) : (
          selectedValues.map(val => (
            <span key={val} className="flex items-center gap-1 bg-[#F1F5F9] border border-[#E2E8F0] px-2 py-0.5 rounded-md text-xs font-medium text-[#475569]">
              <span className="max-w-[100px] truncate">{val}</span>
              <button
                type="button"
                className="hover:text-red-500 rounded-full flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(val);
                }}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))
        )}
        <div className="flex-1 min-w-[2px]" />
        {selectedValues.length > 0 && !disabled && (
          <button
            type="button"
            className="p-1 hover:text-red-500 text-[#94A3B8] transition-colors mr-1"
            onClick={clearAll}
            title="Clear all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <svg className={`w-4 h-4 text-[#64748B] transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      
      {isOpen && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-[#E2E8F0] shadow-lg rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-[#E2E8F0]">
            <input
              type="text"
              autoFocus
              className="w-full px-3 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm focus:outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] text-black"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <ul className="max-h-60 overflow-y-auto custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <li className="px-4 py-3 text-sm text-[#64748B] text-center">No results found</li>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(opt);
                return (
                  <li
                    key={opt}
                    className={`px-4 py-2 text-sm cursor-pointer hover:bg-[#F1F5F9] flex items-center gap-2 transition-colors ${
                      isSelected ? "bg-[#EFF6FF] text-[#3B82F6] font-semibold" : "text-[#1E293B]"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(opt);
                    }}
                  >
                    <input type="checkbox" checked={isSelected} readOnly className="rounded border-gray-300 text-[#3B82F6] focus:ring-[#3B82F6] w-3.5 h-3.5" />
                    <span className="truncate">{opt}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CostSheetDashboard() {
  const [startDate, setStartDate] = useState(firstOfMonthIST);
  const [endDate, setEndDate] = useState(todayIST);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EnrichedRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedCounselors, setSelectedCounselors] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [selectedCashCounters, setSelectedCashCounters] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [syncLimit, setSyncLimit] = useState(500);
  const [progressText, setProgressText] = useState("");
  const [progressFetched, setProgressFetched] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("createdTime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // History Modal State
  const [historyModal, setHistoryModal] = useState<{
    isOpen: boolean;
    type: "patient" | "deal";
    id: number;
    title: string;
    data: EnrichedRow[];
    loading: boolean;
  }>({
    isOpen: false,
    type: "patient",
    id: 0,
    title: "",
    data: [],
    loading: false,
  });

  // Auto-fetch total count when dates change
  React.useEffect(() => {
    if (BITRIX_USER_ID && BITRIX_HOOK_SECRET) {
      setData([]);
      setTotalCount(0);
      fetchInvoiceTotalCount(
        BITRIX_USER_ID,
        BITRIX_HOOK_SECRET,
        toISTString(startDate),
        toISTString(endDate, true),
      ).then((count) => setTotalCount(count));
    }
  }, [startDate, endDate]);

  const handleSync = async () => {
    if (!BITRIX_USER_ID || !BITRIX_HOOK_SECRET) {
      setError("Credentials not found in environment variables");
      return;
    }

    setLoading(true);
    setError(null);
    setData([]);
    setProgressFetched(0);
    setProgressText("Starting...");

    try {
      const result = await fetchCostSheetData({
        userId: BITRIX_USER_ID,
        hook: BITRIX_HOOK_SECRET,
        startIST: toISTString(startDate),
        endIST: toISTString(endDate, true),
        limit: syncLimit,
        onProgress: (fetched, total, stage) => {
          setProgressFetched(fetched);
          setTotalCount(total);
          setProgressText(stage);
        },
      });

      if (result.rows.length === 0) {
        setError("No invoices found for this date range.");
      }

      setData(result.rows);
      setTotalCount(result.totalCount);
    } catch (err: any) {
      setError(err.message || "An error occurred during sync");
    } finally {
      setLoading(false);
      setProgressText("");
    }
  };

  // ─── History Modal Handlers ──────────────────────────────────────────────────

  const handleOpenHistory = async (type: "patient" | "deal", id: number, title: string) => {
    if (!id || !BITRIX_USER_ID || !BITRIX_HOOK_SECRET) return;

    setHistoryModal({ isOpen: true, type, id, title, data: [], loading: true });

    try {
      let historyData = await fetchEntityHistory(
        BITRIX_USER_ID,
        BITRIX_HOOK_SECRET,
        type,
        id
      );

      // Apply active dashboard filters (except date) to the history data
      if (selectedLocations.length > 0) {
        historyData = historyData.filter(r => selectedLocations.includes(r.locationName));
      }
      if (selectedCounselors.length > 0) {
        historyData = historyData.filter(r => selectedCounselors.includes(r.counselorName));
      }
      if (selectedTypes.length > 0) {
        historyData = historyData.filter(r => selectedTypes.includes(r.invoiceType));
      }
      if (selectedDeals.length > 0) {
        historyData = historyData.filter(r => selectedDeals.includes(r.dealTitle));
      }
      if (selectedCashCounters.length > 0) {
        historyData = historyData.filter(r => selectedCashCounters.includes(r.cashCollectedAt));
      }

      setHistoryModal((prev) => ({ ...prev, data: historyData, loading: false }));
    } catch (err: any) {
      console.error("Failed to fetch history", err);
      // Optional: Add a toast notification here
      setHistoryModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const closeHistoryModal = () => {
    setHistoryModal((prev) => ({ ...prev, isOpen: false }));
  };

  // ─── Filter & Sort ──────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    let result = data;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (row) =>
          row.patientName.toLowerCase().includes(q) ||
          row.dealTitle.toLowerCase().includes(q) ||
          row.counselorName.toLowerCase().includes(q) ||
          row.invoiceTitle.toLowerCase().includes(q) ||
          row.productsSummary.toLowerCase().includes(q) ||
          row.invoiceId.toString().includes(q),
      );
    }

    if (selectedLocations.length > 0) {
      result = result.filter((row) => selectedLocations.includes(row.locationName));
    }

    if (selectedCounselors.length > 0) {
      result = result.filter((row) => selectedCounselors.includes(row.counselorName));
    }

    if (selectedTypes.length > 0) {
      result = result.filter((row) => selectedTypes.includes(row.invoiceType));
    }

    if (selectedDeals.length > 0) {
      result = result.filter((row) => selectedDeals.includes(row.dealTitle));
    }

    if (selectedCashCounters.length > 0) {
      result = result.filter((row) => selectedCashCounters.includes(row.cashCollectedAt));
    }

    // Group by Deal ID to collapse multiple invoices for the same deal into one row
    const groupedMap = new Map<string, EnrichedRow>();
    for (const row of result) {
      const key = row.dealId ? `deal_${row.dealId}` : `inv_${row.invoiceId}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, { ...row, products: [...row.products] });
      } else {
        const existing = groupedMap.get(key)!;
        existing.totalAmount += row.totalAmount;
        existing.products.push(...row.products);
        existing.productsSummary = existing.products
          .map((p) => `${p.name} (x${p.quantity})`)
          .join(", ");
      }
    }
    result = Array.from(groupedMap.values());

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "createdTime":
          cmp = new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();
          break;
        case "totalAmount":
          cmp = a.totalAmount - b.totalAmount;
          break;
        case "patientName":
          cmp = a.patientName.localeCompare(b.patientName);
          break;
        case "counselorName":
          cmp = a.counselorName.localeCompare(b.counselorName);
          break;
        case "dealTitle":
          cmp = a.dealTitle.localeCompare(b.dealTitle);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [data, searchQuery, selectedLocations, selectedCounselors, selectedTypes, selectedDeals, selectedCashCounters, sortKey, sortDir]);

  const uniqueLocations = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.locationName))).filter(l => l !== "—").sort();
  }, [data]);

  const uniqueCounselors = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.counselorName))).filter(c => c !== "—").sort();
  }, [data]);

  const uniqueTypes = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.invoiceType))).filter(t => t !== "—").sort();
  }, [data]);

  const uniqueDeals = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.dealTitle))).filter(d => d !== "—").sort();
  }, [data]);

  const uniqueCashCounters = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.cashCollectedAt))).filter(c => c !== "—").sort();
  }, [data]);

  const stats = useMemo(() => {
    const uniquePatients = new Set(filteredData.map((r) => r.patientName)).size;
    const totalRevenue = filteredData.reduce((s, r) => s + r.totalAmount, 0);
    return { uniquePatients, totalRevenue, count: filteredData.length };
  }, [filteredData]);

  // ─── Sort Handler ───────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const renderSortIcon = (field: SortKey) => {
    if (sortKey !== field) return <span className="ml-1 text-[#CBD5E1]">↕</span>;
    return <span className="ml-1 text-[#3B82F6]">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  // ─── Export ─────────────────────────────────────────────────────────────────

  const exportToExcel = () => {
    if (data.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(
      data.map((row) => ({
        "Invoice ID": row.invoiceId,
        "Invoice Title": row.invoiceTitle,
        "Date": formatISTDate(row.createdTime),
        "Patient Name": row.patientName,
        "Deal Title": row.dealTitle,
        "Invoice Type": row.invoiceType,
        "IOL / Lens / Injection": row.iolLensInfo,
        "Payment Mode": row.paymentMode,
        "Panel Name": row.panelName,
        "Cash Collected At": row.cashCollectedAt,
        "Counselor": row.counselorName,
        "Products": row.productsSummary,
        "Total Amount (INR)": row.totalAmount,
      })),
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cost Sheet");

    const fileName = `CostSheet_${startDate}_to_${endDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const progressPercent = totalCount > 0
    ? Math.min(100, Math.round((progressFetched / Math.min(syncLimit, totalCount)) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h1 className="text-3xl font-bold text-[#1E293B] mb-2">
                Medical Cost Sheet
              </h1>
              <p className="text-[#64748B]">
                Enriched Smart Invoice Transactions with Patient & Financial Details
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="px-4 py-2 bg-white border border-[#E2E8F0] text-[#475569] hover:text-[#3B82F6] hover:border-[#3B82F6] rounded-xl text-sm font-semibold transition-all shadow-xs flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Inventory
              </Link>
              <button
                onClick={() => signOut()}
                className="px-4 py-2 bg-white border border-[#E2E8F0] text-[#64748B] hover:text-[#EF4444] hover:border-[#EF4444] rounded-xl text-sm font-semibold transition-all shadow-xs active:scale-[0.98] flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Config Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end mb-4">
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Start Date
              </label>
              <input
                type="date"
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                End Date
              </label>
              <input
                type="date"
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Search
              </label>
              <input
                type="text"
                placeholder="Filter by patient, deal, counselor..."
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#475569] mb-2 flex justify-between items-center">
                <span>Sync Limit</span>
                {totalCount > 0 && (
                  <span className="text-[10px] font-bold bg-[#E0F2FE] text-[#0369A1] px-2 py-0.5 rounded-md">
                    Total: {totalCount}
                  </span>
                )}
              </label>
              <input
                type="number"
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={syncLimit}
                onChange={(e) => setSyncLimit(parseInt(e.target.value) || 50)}
              />
            </div>
            <div>
              <button
                onClick={handleSync}
                disabled={loading}
                className={`w-full py-2.5 rounded-xl font-semibold text-white transition-all shadow-md ${
                  loading
                    ? "bg-[#94A3B8] cursor-not-allowed"
                    : "bg-[#7C3AED] hover:bg-[#6D28D9] active:scale-[0.98]"
                }`}
              >
                {loading
                  ? `Syncing (${progressFetched})...`
                  : "Sync Cost Sheet"}
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-10 gap-4 items-end mt-4">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Location
              </label>
              <SearchableDropdown
                options={uniqueLocations}
                selectedValues={selectedLocations}
                onChange={setSelectedLocations}
                disabled={data.length === 0}
                placeholder="All Locations"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Counselor
              </label>
              <SearchableDropdown
                options={uniqueCounselors}
                selectedValues={selectedCounselors}
                onChange={setSelectedCounselors}
                disabled={data.length === 0}
                placeholder="All Counselors"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Invoice Type
              </label>
              <SearchableDropdown
                options={uniqueTypes}
                selectedValues={selectedTypes}
                onChange={setSelectedTypes}
                disabled={data.length === 0}
                placeholder="All Types"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Deal
              </label>
              <SearchableDropdown
                options={uniqueDeals}
                selectedValues={selectedDeals}
                onChange={setSelectedDeals}
                disabled={data.length === 0}
                placeholder="All Deals"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Cash Counter
              </label>
              <SearchableDropdown
                options={uniqueCashCounters}
                selectedValues={selectedCashCounters}
                onChange={setSelectedCashCounters}
                disabled={data.length === 0}
                placeholder="All Counters"
              />
            </div>
          </div>

          {/* Progress Bar */}
          {loading && (
            <div className="mt-6 transition-all duration-500 ease-in-out">
              <div className="flex justify-between text-sm mb-2 text-[#475569] font-medium">
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-[#7C3AED]"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {progressText}
                </span>
                <span className="text-[#7C3AED] font-bold">{progressPercent}%</span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-2 overflow-hidden shadow-inner">
                <div
                  className="bg-linear-to-r from-[#7C3AED] to-[#A78BFA] h-2 rounded-full transition-all duration-300 ease-out relative"
                  style={{ width: `${progressPercent}%` }}
                >
                  <div className="absolute top-0 right-0 bottom-0 left-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progressBar_1s_linear_infinite]" />
                </div>
              </div>
              <style>{`
                @keyframes progressBar {
                  0% { background-position: 1rem 0; }
                  100% { background-position: 0 0; }
                }
              `}</style>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-[#EF4444] font-medium">{error}</p>
          )}
        </div>

        {/* Stats Cards */}
        {data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
              <p className="text-sm font-medium text-[#64748B] mb-1">Total Invoices</p>
              <h3 className="text-2xl font-bold text-[#1E293B]">{stats.count}</h3>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
              <p className="text-sm font-medium text-[#64748B] mb-1">Unique Patients</p>
              <h3 className="text-2xl font-bold text-[#7C3AED]">{stats.uniquePatients}</h3>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
              <p className="text-sm font-medium text-[#64748B] mb-1">Total Revenue</p>
              <h3 className="text-2xl font-bold text-[#10B981]">
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(stats.totalRevenue)}
              </h3>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-[#1E293B]">
                Cost Sheet
              </h2>
              {data.length > 0 && (
                <button
                  onClick={exportToExcel}
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export Excel
                </button>
              )}
            </div>
            <span className="text-sm font-medium text-[#64748B] flex items-center gap-2">
              <span>{startDate} → {endDate}</span>
              {data.length > 0 && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-md text-xs font-bold">
                  {data.length} Invoices
                </span>
              )}
            </span>
          </div>

          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    ID
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("createdTime")}
                  >
                    Date {renderSortIcon("createdTime")}
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("patientName")}
                  >
                    Patient {renderSortIcon("patientName")}
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("dealTitle")}
                  >
                    Deal {renderSortIcon("dealTitle")}
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    IOL / Lens
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("counselorName")}
                  >
                    Counselor {renderSortIcon("counselorName")}
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Products
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap text-right cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("totalAmount")}
                  >
                    Amount {renderSortIcon("totalAmount")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredData.length > 0
                  ? filteredData.map((row) => (
                      <tr
                        key={row.invoiceId}
                        className="hover:bg-[#F1F5F9] transition-colors group"
                      >
                        <td className="px-4 py-3 text-xs text-[#94A3B8] font-mono">
                          {row.invoiceId}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#475569] whitespace-nowrap">
                          {formatISTDate(row.createdTime)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleOpenHistory("patient", row.patientId, row.patientName)}
                            className="text-sm font-semibold text-[#1E293B] group-hover:text-[#7C3AED] hover:underline transition-colors max-w-[180px] truncate text-left w-full block"
                            title={row.patientName}
                          >
                            {row.patientName}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleOpenHistory("deal", row.dealId, row.dealTitle)}
                            className="text-sm text-[#475569] hover:text-[#7C3AED] hover:underline max-w-[160px] truncate text-left w-full block transition-colors"
                            title={row.dealTitle}
                          >
                            {row.dealTitle}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#EDE9FE] text-[#6D28D9] whitespace-nowrap">
                            {row.invoiceType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-[#475569] max-w-[120px] truncate block" title={row.iolLensInfo}>
                            {row.iolLensInfo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-[#475569] max-w-[140px] truncate" title={row.counselorName}>
                            {row.counselorName}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-[#64748B] max-w-[200px] truncate" title={row.productsSummary}>
                            {row.productsSummary}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-[#0F172A] font-bold whitespace-nowrap">
                            {new Intl.NumberFormat("en-IN", {
                              style: "currency",
                              currency: "INR",
                              maximumFractionDigits: 0,
                            }).format(row.totalAmount)}
                          </span>
                        </td>
                      </tr>
                    ))
                  : !loading && (
                      <tr>
                        <td colSpan={11} className="px-6 py-12 text-center text-[#94A3B8]">
                          {BITRIX_USER_ID
                            ? "Select a date range and click Sync to load cost sheet data"
                            : "Configure BITRIX credentials in .env.local"}
                        </td>
                      </tr>
                    )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* History Modal */}
      {historyModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex justify-between items-center bg-[#F8FAFC]">
              <div>
                <h3 className="text-lg font-bold text-[#1E293B]">
                  {historyModal.type === "patient" ? "Patient History" : "Deal History"}
                </h3>
                <p className="text-sm text-[#64748B] mt-0.5">
                  {historyModal.title}
                </p>
              </div>
              <button
                onClick={closeHistoryModal}
                className="text-[#64748B] hover:text-[#1E293B] bg-white border border-[#E2E8F0] p-2 rounded-xl shadow-xs transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 bg-white">
              {historyModal.loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-[#64748B]">
                  <svg className="animate-spin h-8 w-8 text-[#7C3AED] mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="font-medium animate-pulse">Fetching historical data from Bitrix...</p>
                </div>
              ) : historyModal.data.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-[#64748B] font-medium">
                  No past invoices found.
                </div>
              ) : (
                <div className="border border-[#E2E8F0] rounded-xl overflow-auto shadow-sm">
                  <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Date</th>
                        {historyModal.type === "patient" && (
                          <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Deal</th>
                        )}
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Payment</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Panel</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Cash At</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Counselor</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider">Products</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {historyModal.data.map((row) => (
                        <tr key={row.invoiceId} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="px-4 py-3 text-sm text-[#475569] font-medium">
                            {formatISTDate(row.createdTime)}
                          </td>
                          {historyModal.type === "patient" && (
                            <td className="px-4 py-3">
                              <span className="text-sm text-[#475569] max-w-[140px] truncate block" title={row.dealTitle}>
                                {row.dealTitle}
                              </span>
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#EDE9FE] text-[#6D28D9] whitespace-nowrap">
                              {row.invoiceType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E] whitespace-nowrap">
                              {row.paymentMode}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-[#475569] max-w-[120px] truncate block" title={row.panelName}>
                              {row.panelName}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-[#475569] max-w-[120px] truncate block" title={row.cashCollectedAt}>
                              {row.cashCollectedAt}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#475569]">
                            {row.counselorName}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#64748B] max-w-[200px] truncate" title={row.productsSummary}>
                            {row.productsSummary}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#0F172A] font-bold text-right whitespace-nowrap">
                            {new Intl.NumberFormat("en-IN", {
                              style: "currency",
                              currency: "INR",
                              maximumFractionDigits: 0,
                            }).format(row.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {!historyModal.loading && historyModal.data.length > 0 && (
              <div className="px-6 py-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex justify-between items-center text-sm">
                <span className="font-semibold text-[#475569] bg-white px-3 py-1.5 rounded-lg border border-[#E2E8F0] shadow-xs">
                  {historyModal.data.length} Total Invoices
                </span>
                <span className="font-bold text-[#10B981] bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 text-base">
                  {new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(historyModal.data.reduce((s, r) => s + r.totalAmount, 0))}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
