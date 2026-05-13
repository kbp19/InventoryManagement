"use client";

import React, { useState } from "react";
import {
  fetchBitrixData,
  fetchTotalCount,
  fetchHospitalLocations,
  fetchListElements,
  AggregatedProduct,
} from "@/lib/bitrix";
import * as XLSX from "xlsx";
import { signOut } from "next-auth/react";

const BITRIX_USER_ID = process.env.NEXT_PUBLIC_BITRIX_USER_ID || "";
const BITRIX_HOOK_SECRET = process.env.NEXT_PUBLIC_BITRIX_HOOK_SECRET || "";

export default function BitrixDashboard() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<number | "All">("All");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedProduct[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [syncLimit, setSyncLimit] = useState(500);
  const [hospitalLocations, setHospitalLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [invoiceTypes, setInvoiceTypes] = useState<any[]>([]);
  const [selectedInvoiceType, setSelectedInvoiceType] = useState("All");
  const [createdAtOptions, setCreatedAtOptions] = useState<any[]>([]);
  const [selectedCreatedAt, setSelectedCreatedAt] = useState("All");

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() - i,
  );

  React.useEffect(() => {
    if (BITRIX_USER_ID && BITRIX_HOOK_SECRET) {
      fetchHospitalLocations(BITRIX_USER_ID, BITRIX_HOOK_SECRET).then((data) => {
        setHospitalLocations(data);
      });
      fetchListElements(BITRIX_USER_ID, BITRIX_HOOK_SECRET, 132).then((data) => {
        setInvoiceTypes(data);
      });
      fetchListElements(BITRIX_USER_ID, BITRIX_HOOK_SECRET, 104).then((data) => {
        setCreatedAtOptions(data);
      });
    } else {
      setHospitalLocations([]);
      setSelectedLocation("All");
    }
  }, []);

  // Auto-fetch total count and clear old data when month/year changes
  React.useEffect(() => {
    if (BITRIX_USER_ID && BITRIX_HOOK_SECRET) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData([]);
      setTotalInvoices(0);
      fetchTotalCount(
        BITRIX_USER_ID,
        BITRIX_HOOK_SECRET,
        selectedMonth,
        selectedYear,
        selectedLocation,
        "ufCrm_634952003E51B",
        selectedDay,
        selectedInvoiceType,
        selectedCreatedAt
      ).then((count) => setTotalCount(count));
    } else {
      setData([]);
      setTotalInvoices(0);
      setTotalCount(0);
    }
  }, [selectedMonth, selectedYear, selectedLocation, selectedDay, selectedInvoiceType, selectedCreatedAt]);

  const handleFetch = async () => {
    if (!BITRIX_USER_ID || !BITRIX_HOOK_SECRET) {
      setError("Credentials not found in environment variables");
      return;
    }

    setLoading(true);
    setError(null);
    setData([]);
    setTotalInvoices(0);
    // Note: totalCount is preserved to keep the progress bar context

    try {
      let currentStart: number | null = 0;
      let accumulatedTotal = 0;
      const mergedData: AggregatedProduct[] = [];

      // Use chunks of 500 for a balance between speed and UI progress feedback
      while (currentStart !== null && accumulatedTotal < syncLimit) {
        const currentLimit = Math.min(500, syncLimit - accumulatedTotal);
        const result = await fetchBitrixData(
          BITRIX_USER_ID,
          BITRIX_HOOK_SECRET,
          selectedMonth,
          selectedYear,
          selectedLocation,
          currentStart,
          currentLimit,
          "ufCrm_634952003E51B",
          selectedDay,
          selectedInvoiceType,
          selectedCreatedAt
        );

        // Merge products
        result.products.forEach((newProd) => {
          const existing = mergedData.find((p) => p.name === newProd.name);
          if (existing) {
            existing.deals += newProd.deals;
            existing.quantitySold += newProd.quantitySold;
            existing.revenue += newProd.revenue;
          } else {
            mergedData.push(newProd);
          }
        });

        accumulatedTotal += result.totalInvoices;
        currentStart = result.nextStart;

        // Update UI state progressively
        setData([...mergedData].sort((a, b) => b.revenue - a.revenue));
        setTotalInvoices(accumulatedTotal);
        setTotalCount(result.totalCount);

        if (result.totalInvoices === 0) break;
      }

      if (accumulatedTotal === 0) {
        setError("No invoices found for this period.");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred during sync");
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const exportToExcel = () => {
    if (data.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(
      data.map((item) => ({
        "Product Name": item.name,
        Location: item.locationId,
        Deals: item.deals,
        "Quantity Sold": item.quantitySold,
        "Net Price": item.netPrice,
        "Revenue (INR)": item.revenue,
        "Last Transaction": item.lastDate,
      })),
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");

    // Generate filename with month and year
    const fileName = `Inventory_${months[selectedMonth]}_${selectedYear}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h1 className="text-3xl font-bold text-[#1E293B] mb-2">
                Inventory Management
              </h1>
              <p className="text-[#64748B]">
                Bitrix24 Smart Invoices Product Analysis
              </p>
            </div>
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

        {/* Config Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-9 gap-4 items-end">
            <div className="lg:col-span-1">
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Search Product
              </label>
              <input
                type="text"
                placeholder="Filter by name..."
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Month
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              >
                {months.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Day
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value === "All" ? "All" : parseInt(e.target.value))}
              >
                <option value="All">All Days</option>
                {Array.from({ length: new Date(selectedYear, selectedMonth + 1, 0).getDate() }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Year
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Location
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="All">All Locations</option>
                {hospitalLocations.map((loc: any) => (
                  <option key={loc.ID} value={loc.ID} title={loc.NAME}>
                    {loc.NAME.length > 40 ? loc.NAME.substring(0, 40) + "..." : loc.NAME}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Invoice Type
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedInvoiceType}
                onChange={(e) => setSelectedInvoiceType(e.target.value)}
              >
                <option value="All">All Types</option>
                {invoiceTypes.map((type: any) => (
                  <option key={type.ID} value={type.ID} title={type.NAME}>
                    {type.NAME.length > 30 ? type.NAME.substring(0, 30) + "..." : type.NAME}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Created At
              </label>
              <select
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={selectedCreatedAt}
                onChange={(e) => setSelectedCreatedAt(e.target.value)}
              >
                <option value="All">All Values</option>
                {createdAtOptions.map((opt: any) => (
                  <option key={opt.ID} value={opt.ID} title={opt.NAME}>
                    {opt.NAME.length > 30 ? opt.NAME.substring(0, 30) + "..." : opt.NAME}
                  </option>
                ))}
              </select>
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
                onClick={() => handleFetch()}
                disabled={loading}
                className={`w-full py-2.5 rounded-xl font-semibold text-white transition-all shadow-md ${
                  loading
                    ? "bg-[#94A3B8] cursor-not-allowed"
                    : "bg-[#3B82F6] hover:bg-[#2563EB] active:scale-[0.98]"
                }`}
              >
                {loading
                  ? `Syncing (${totalInvoices} / ${Math.min(syncLimit, totalCount || syncLimit)})...`
                  : "Sync Inventory"}
              </button>
            </div>
          </div>

          {loading && (
            <div className="mt-6 transition-all duration-500 ease-in-out">
              <div className="flex justify-between text-sm mb-2 text-[#475569] font-medium">
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-[#3B82F6]"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Syncing Invoices...
                </span>
                <span className="text-[#3B82F6] font-bold">
                  {Math.round(
                    (totalInvoices /
                      Math.max(
                        1,
                        Math.min(syncLimit, totalCount || syncLimit),
                      )) *
                      100,
                  )}
                  %
                </span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-2 overflow-hidden shadow-inner">
                <div
                  className="bg-linear-to-r from-[#3B82F6] to-[#60A5FA] h-2 rounded-full transition-all duration-300 ease-out relative"
                  style={{
                    width: `${Math.min(100, Math.max(0, (totalInvoices / Math.max(1, Math.min(syncLimit, totalCount || syncLimit))) * 100))}%`,
                  }}
                >
                  <div className="absolute top-0 right-0 bottom-0 left-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progressBar_1s_linear_infinite]"></div>
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
              <p className="text-sm font-medium text-[#64748B] mb-1">
                Total Invoices
              </p>
              <h3 className="text-2xl font-bold text-[#1E293B]">
                {totalInvoices}
              </h3>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
              <p className="text-sm font-medium text-[#64748B] mb-1">
                Total Quantity Sold
              </p>
              <h3 className="text-2xl font-bold text-[#1E293B]">
                {filteredData
                  .reduce((acc, curr) => acc + curr.quantitySold, 0)
                  .toLocaleString()}
              </h3>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
              <p className="text-sm font-medium text-[#64748B] mb-1">
                Total Revenue
              </p>
              <h3 className="text-2xl font-bold text-[#10B981]">
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(
                  filteredData.reduce((acc, curr) => acc + curr.revenue, 0),
                )}
              </h3>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-[#1E293B]">
                Inventory Overview
              </h2>
              {data.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportToExcel}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all active:scale-[0.98]"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Export
                  </button>
                </div>
              )}
            </div>
            <span className="text-sm font-medium text-[#64748B] flex items-center gap-2">
              <span>
                {months[selectedMonth]} {selectedYear}
              </span>
              {totalInvoices > 0 && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-xs font-bold">
                  {totalInvoices} Invoices
                </span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    Product & Location
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-center">
                    Deals
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-center">
                    Qty
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-right">
                    Net Price
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-right">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredData.length > 0
                  ? filteredData.map((item, index) => (
                      <tr
                        key={index}
                        className="hover:bg-[#F1F5F9] transition-colors group"
                      >
                        <td className="px-6 py-4">
                          <div className="font-semibold text-[#1E293B] group-hover:text-[#3B82F6] transition-colors">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-[#64748B] font-medium flex items-center gap-1 mt-0.5">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {item.locationId}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="px-2.5 py-0.5 rounded-full text-sm font-medium bg-[#F1F5F9] text-[#475569]">
                            {item.deals}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-[#475569] font-medium">
                            {item.quantitySold}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-[#475569] font-medium">
                            {new Intl.NumberFormat("en-IN", {
                              style: "currency",
                              currency: "INR",
                              maximumFractionDigits: 0,
                            }).format(item.netPrice)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-[#0F172A] font-bold">
                            {new Intl.NumberFormat("en-IN", {
                              style: "currency",
                              currency: "INR",
                              maximumFractionDigits: 0,
                            }).format(item.revenue)}
                          </span>
                        </td>
                      </tr>
                    ))
                  : !loading && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-12 text-center text-[#94A3B8]"
                        >
                          {BITRIX_USER_ID
                            ? "No data found for this period"
                            : "Configure BITRIX credentials in .env.local to load inventory data"}
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
