"use client";

import React, { useState, useMemo } from "react";
import {
  fetchCostSheetData,
  fetchInvoiceTotalCount,
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

type SortKey = "createdTime" | "totalAmount" | "patientName" | "counselorName";
type SortDir = "asc" | "desc";

export default function CostSheetDashboard() {
  const [startDate, setStartDate] = useState(firstOfMonthIST);
  const [endDate, setEndDate] = useState(todayIST);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EnrichedRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [selectedCounselor, setSelectedCounselor] = useState("All");
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [syncLimit, setSyncLimit] = useState(500);
  const [progressText, setProgressText] = useState("");
  const [progressFetched, setProgressFetched] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("createdTime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

    if (selectedLocation !== "All") {
      result = result.filter((row) => row.locationName === selectedLocation);
    }

    if (selectedCounselor !== "All") {
      result = result.filter((row) => row.counselorName === selectedCounselor);
    }

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
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [data, searchQuery, selectedLocation, selectedCounselor, sortKey, sortDir]);

  const uniqueLocations = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.locationName))).filter(l => l !== "—").sort();
  }, [data]);

  const uniqueCounselors = useMemo(() => {
    return Array.from(new Set(data.map((r) => r.counselorName))).filter(c => c !== "—").sort();
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

  const SortIcon = ({ field }: { field: SortKey }) => {
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
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Filter by Location
              </label>
              <select
                className={`w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black ${
                  data.length === 0 ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""
                }`}
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                disabled={data.length === 0}
              >
                <option value="All">All Locations</option>
                {uniqueLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Filter by Counselor
              </label>
              <select
                className={`w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black ${
                  data.length === 0 ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""
                }`}
                value={selectedCounselor}
                onChange={(e) => setSelectedCounselor(e.target.value)}
                disabled={data.length === 0}
              >
                <option value="All">All Counselors</option>
                {uniqueCounselors.map((counselor) => (
                  <option key={counselor} value={counselor}>
                    {counselor}
                  </option>
                ))}
              </select>
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
                    Date <SortIcon field="createdTime" />
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("patientName")}
                  >
                    Patient <SortIcon field="patientName" />
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Deal
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    IOL / Lens
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Payment
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Cash At
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("counselorName")}
                  >
                    Counselor <SortIcon field="counselorName" />
                  </th>
                  <th className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">
                    Products
                  </th>
                  <th
                    className="px-4 py-3 text-xs font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap text-right cursor-pointer hover:text-[#3B82F6] select-none"
                    onClick={() => handleSort("totalAmount")}
                  >
                    Amount <SortIcon field="totalAmount" />
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
                          <div className="text-sm font-semibold text-[#1E293B] group-hover:text-[#7C3AED] transition-colors max-w-[180px] truncate" title={row.patientName}>
                            {row.patientName}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-[#475569] max-w-[160px] truncate" title={row.dealTitle}>
                            {row.dealTitle}
                          </div>
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
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E] whitespace-nowrap">
                            {row.paymentMode}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-[#475569] max-w-[120px] truncate block" title={row.cashCollectedAt}>
                            {row.cashCollectedAt}
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
    </div>
  );
}
