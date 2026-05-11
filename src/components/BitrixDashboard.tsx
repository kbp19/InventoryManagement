"use client";

import React, { useState } from "react";
import {
  fetchBitrixData,
  fetchTotalCount,
  AggregatedProduct,
} from "@/lib/bitrix";
import * as XLSX from "xlsx";

export default function BitrixDashboard() {
  const [userId, setUserId] = useState("");
  const [hook, setHook] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [nextStart, setNextStart] = useState<number | null>(null);
  const [syncLimit, setSyncLimit] = useState(500);

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

  // Auto-fetch total count and clear old data when month/year changes
  React.useEffect(() => {
    if (userId && hook) {
      setData([]);
      setTotalInvoices(0);
      setNextStart(0);
      fetchTotalCount(userId, hook, selectedMonth, selectedYear).then((count) =>
        setTotalCount(count),
      );
    } else {
      setData([]);
      setTotalInvoices(0);
      setTotalCount(0);
    }
  }, [userId, hook, selectedMonth, selectedYear]);

  const handleFetch = async () => {
    if (!userId || !hook) {
      setError("Please enter both User ID and Hook");
      return;
    }

    setLoading(true);
    setError(null);
    setData([]);
    setTotalInvoices(0);
    setNextStart(null);
    // Note: totalCount is preserved to keep the progress bar context

    try {
      let currentStart: number | null = 0;
      let accumulatedTotal = 0;
      let mergedData: AggregatedProduct[] = [];

      // Use chunks of 500 for a balance between speed and UI progress feedback
      while (currentStart !== null && accumulatedTotal < syncLimit) {
        const currentLimit = Math.min(500, syncLimit - accumulatedTotal);
        const result = await fetchBitrixData(
          userId,
          hook,
          selectedMonth,
          selectedYear,
          "All",
          currentStart,
          currentLimit,
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
        setNextStart(currentStart);

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

  const filteredData = data;

  const exportToExcel = () => {
    if (data.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(
      data.map((item) => ({
        "Product Name": item.name,
        Deals: item.deals,
        "Quantity Sold": item.quantitySold,
        "Revenue (INR)": item.revenue,
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
          <h1 className="text-3xl font-bold text-[#1E293B] mb-2">
            Inventory Management
          </h1>
          <p className="text-[#64748B]">
            Bitrix24 Smart Invoices Product Analysis
          </p>
        </div>

        {/* Config Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 items-end">
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                User ID
              </label>
              <input
                type="text"
                placeholder="e.g. 1"
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#475569] mb-2">
                Webhook Secret (Hook)
              </label>
              <input
                type="password"
                placeholder="e.g. abcdefgh12345678"
                className="w-full px-4 py-2 rounded-xl border border-[#CBD5E1] focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent outline-none transition-all text-black"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
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
              <label className="block text-sm font-medium text-[#475569] mb-2 flex justify-between items-center">
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
                    Product
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-center">
                    Deals
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-[#64748B] uppercase tracking-wider text-center">
                    Qty
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
                          {userId
                            ? "No data found for this period"
                            : "Enter credentials to load inventory data"}
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
