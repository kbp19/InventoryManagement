// Cost Sheet Data Pipeline
// Fetches Smart Invoices (Entity 31) and hydrates them with relational lookups

import { fetchHospitalLocations } from "./bitrix";

const BASE_DOMAIN = "https://crm.mantracare.com/rest";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawInvoice {
  id: number;
  createdTime: string;
  title: string;
  companyId: number;
  parentId2: number;
  ufCrm_69CA54F0B8EAC: number | string;
  ufCrm_672EEAD954CF9: number | string;
  ufCrm_682EB9C9759AE: number | string;
  ufCrm_686636FD83021: number | string;
  assignedById: number;
  ufCrm_619DF82A0B29B: number | string;
  [key: string]: any;
}

export interface ProductDetail {
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface EnrichedRow {
  invoiceId: number;
  invoiceTitle: string;
  createdTime: string;
  patientId: number;
  patientName: string;
  dealId: number;
  dealTitle: string;
  invoiceType: string;
  iolLensInfo: string;
  paymentMode: string;
  cashCollectedAt: string;
  counselorName: string;
  locationName: string;
  products: ProductDetail[];
  productsSummary: string;
  totalAmount: number;
}

export interface CostSheetResult {
  rows: EnrichedRow[];
  totalInvoices: number;
  totalCount: number;
  nextStart: number | null;
}

interface LookupCaches {
  patients: Map<number, string>;
  deals: Map<number, string>;
  invoiceTypes: Map<number, string>;
  iolLens: Map<number, string>;
  paymentModes: Map<number, string>;
  cashCollectedAt: Map<number, string>;
  counselors: Map<number, string>;
  locations: Map<string, string>;
  products: Map<number, ProductDetail[]>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl(userId: string, hook: string): string {
  return `${BASE_DOMAIN}/${userId}/${hook}`;
}

function toNum(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/** Deduplicate and filter out zero/empty IDs */
function uniqueIds(ids: (number | string | undefined | null)[]): number[] {
  const set = new Set<number>();
  for (const raw of ids) {
    const n = toNum(raw);
    if (n > 0) set.add(n);
  }
  return Array.from(set);
}

/** Split array into chunks of given size */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ─── Invoice Fetching ────────────────────────────────────────────────────────

const INVOICE_SELECT_FIELDS = [
  "id",
  "title",
  "createdTime",
  "companyId",
  "parentId2",
  "ufCrm_69CA54F0B8EAC",
  "ufCrm_672EEAD954CF9",
  "ufCrm_682EB9C9759AE",
  "ufCrm_686636FD83021",
  "assignedById",
  "ufCrm_619DF82A0B29B",
  "ufCrm_634952003E51B",
];

export async function fetchInvoicesByDateRange(
  userId: string,
  hook: string,
  startIST: string,
  endIST: string,
  start: number = 0,
): Promise<{ items: RawInvoice[]; total: number; next: number | null }> {
  const url = baseUrl(userId, hook);

  const res = await fetch(`${url}/crm.item.list.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityTypeId: 31,
      select: INVOICE_SELECT_FIELDS,
      order: { createdTime: "DESC" },
      filter: {
        ">=createdTime": startIST,
        "<=createdTime": endIST,
      },
      start,
    }),
  });

  const data = await res.json();
  return {
    items: (data.result?.items || []) as RawInvoice[],
    total: data.total || 0,
    next: data.next ?? null,
  };
}

export async function fetchInvoiceTotalCount(
  userId: string,
  hook: string,
  startIST: string,
  endIST: string,
): Promise<number> {
  const url = baseUrl(userId, hook);
  const res = await fetch(`${url}/crm.item.list.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityTypeId: 31,
      select: ["id"],
      filter: {
        ">=createdTime": startIST,
        "<=createdTime": endIST,
      },
      limit: 1,
    }),
  });
  const data = await res.json();
  return data.total || 0;
}

// ─── Bulk Resolve: CRM Items (Patients & Deals) ─────────────────────────────

async function bulkResolveCrmItems(
  userId: string,
  hook: string,
  entityTypeId: number,
  ids: number[],
): Promise<Map<number, string>> {
  const url = baseUrl(userId, hook);
  const map = new Map<number, string>();
  if (ids.length === 0) return map;

  // Batch API: up to 50 sub-calls per batch request
  const chunks = chunk(ids, 50);

  for (const idChunk of chunks) {
    const batchCmd: Record<string, string> = {};
    idChunk.forEach((id, i) => {
      const params = new URLSearchParams();
      params.append("entityTypeId", entityTypeId.toString());
      params.append("filter[ID]", id.toString());
      params.append("select[0]", "id");
      params.append("select[1]", "title");
      batchCmd[`q${i}`] = `crm.item.list?${params.toString()}`;
    });

    const res = await fetch(`${url}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halt: 0, cmd: batchCmd }),
    });
    const data = await res.json();

    if (data.result?.result) {
      idChunk.forEach((id, i) => {
        const result = data.result.result[`q${i}`];
        const item = result?.items?.[0];
        if (item) {
          map.set(id, item.title || `#${id}`);
        }
      });
    }
  }

  return map;
}

export async function bulkResolvePatients(
  userId: string,
  hook: string,
  companyIds: number[],
): Promise<Map<number, string>> {
  return bulkResolveCrmItems(userId, hook, 4, companyIds);
}

export async function bulkResolveDeals(
  userId: string,
  hook: string,
  dealIds: number[],
): Promise<Map<number, string>> {
  return bulkResolveCrmItems(userId, hook, 2, dealIds);
}

// ─── Bulk Resolve: List Elements ─────────────────────────────────────────────

export async function bulkResolveListElements(
  userId: string,
  hook: string,
  iblockId: number,
  elementIds: number[],
): Promise<Map<number, string>> {
  const url = baseUrl(userId, hook);
  const map = new Map<number, string>();
  if (elementIds.length === 0) return map;

  const chunks = chunk(elementIds, 50);

  for (const idChunk of chunks) {
    const batchCmd: Record<string, string> = {};
    idChunk.forEach((id, i) => {
      const params = new URLSearchParams();
      params.append("IBLOCK_TYPE_ID", "lists");
      params.append("IBLOCK_ID", iblockId.toString());
      params.append("ELEMENT_ID", id.toString());
      batchCmd[`q${i}`] = `lists.element.get?${params.toString()}`;
    });

    const res = await fetch(`${url}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halt: 0, cmd: batchCmd }),
    });
    const data = await res.json();

    if (data.result?.result) {
      idChunk.forEach((id, i) => {
        const result = data.result.result[`q${i}`];
        if (Array.isArray(result) && result.length > 0) {
          map.set(id, result[0].NAME || `#${id}`);
        }
      });
    }
  }

  return map;
}

// ─── Bulk Resolve: Users (Counselors) ────────────────────────────────────────

export async function bulkResolveUsers(
  userId: string,
  hook: string,
  userIds: number[],
): Promise<Map<number, string>> {
  const url = baseUrl(userId, hook);
  const map = new Map<number, string>();
  if (userIds.length === 0) return map;

  const chunks = chunk(userIds, 50);

  for (const idChunk of chunks) {
    const batchCmd: Record<string, string> = {};
    idChunk.forEach((id, i) => {
      const params = new URLSearchParams();
      params.append("filter[ID]", id.toString());
      batchCmd[`q${i}`] = `user.get?${params.toString()}`;
    });

    const res = await fetch(`${url}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halt: 0, cmd: batchCmd }),
    });
    const data = await res.json();

    if (data.result?.result) {
      idChunk.forEach((id, i) => {
        const result = data.result.result[`q${i}`];
        if (Array.isArray(result) && result.length > 0) {
          const user = result[0];
          const fullName = [user.NAME, user.LAST_NAME].filter(Boolean).join(" ");
          map.set(id, fullName || `User #${id}`);
        }
      });
    }
  }

  return map;
}

// ─── Bulk Resolve: Product Rows ──────────────────────────────────────────────

export async function fetchProductRows(
  userId: string,
  hook: string,
  invoiceIds: number[],
): Promise<Map<number, ProductDetail[]>> {
  const url = baseUrl(userId, hook);
  const map = new Map<number, ProductDetail[]>();
  if (invoiceIds.length === 0) return map;

  const chunks = chunk(invoiceIds, 50);

  for (const idChunk of chunks) {
    const batchCmd: Record<string, string> = {};
    idChunk.forEach((id, i) => {
      batchCmd[`q${i}`] =
        `crm.item.productrow.list?filter%5B%3DownerType%5D=SI&filter%5B%3DownerId%5D=${id}`;
    });

    const res = await fetch(`${url}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halt: 0, cmd: batchCmd }),
    });
    const data = await res.json();

    if (data.result?.result) {
      idChunk.forEach((id, i) => {
        const result = data.result.result[`q${i}`];
        const rows = result?.productRows || [];
        const products: ProductDetail[] = rows.map((r: any) => ({
          name: r.productName || "Unknown",
          quantity: Number(r.quantity) || 0,
          price: Number(r.price) || 0,
          total: Number(r.priceBrutto) || 0,
        }));
        map.set(id, products);
      });
    }
  }

  return map;
}

// ─── Hydration: Combine Raw Invoices with Lookup Caches ──────────────────────

function hydrateInvoices(
  rawInvoices: RawInvoice[],
  caches: LookupCaches,
): EnrichedRow[] {
  return rawInvoices.map((invoice) => {
    const products = caches.products.get(invoice.id) || [];
    const totalAmount = products.reduce((sum, p) => sum + p.total, 0);
    const productsSummary = products
      .map((p) => `${p.name} (x${p.quantity})`)
      .join(", ");

    // Counselor: prefer ufCrm_619DF82A0B29B, fallback to assignedById
    const counselorId = toNum(invoice.ufCrm_619DF82A0B29B) || toNum(invoice.assignedById);

    const locId = String(invoice.ufCrm_634952003E51B || "");

    return {
      invoiceId: invoice.id,
      invoiceTitle: invoice.title || `Invoice #${invoice.id}`,
      createdTime: invoice.createdTime,
      patientId: invoice.companyId,
      patientName:
        caches.patients.get(invoice.companyId) ||
        (invoice.companyId ? `Unknown Company (${invoice.companyId})` : "—"),
      dealId: invoice.parentId2,
      dealTitle:
        caches.deals.get(invoice.parentId2) ||
        (invoice.parentId2 ? `Unknown Deal (${invoice.parentId2})` : "—"),
      invoiceType: caches.invoiceTypes.get(toNum(invoice.ufCrm_69CA54F0B8EAC)) || "—",
      iolLensInfo: caches.iolLens.get(toNum(invoice.ufCrm_672EEAD954CF9)) || "—",
      paymentMode: caches.paymentModes.get(toNum(invoice.ufCrm_682EB9C9759AE)) || "—",
      cashCollectedAt: caches.cashCollectedAt.get(toNum(invoice.ufCrm_686636FD83021)) || "—",
      counselorName: caches.counselors.get(counselorId) || (counselorId > 0 ? `User #${counselorId}` : "—"),
      locationName: caches.locations.get(locId) || (locId ? "—" : "—"),
      products,
      productsSummary: productsSummary || "—",
      totalAmount,
    };
  });
}

// ─── Orchestrator: Full Pipeline ─────────────────────────────────────────────

export interface FetchCostSheetOptions {
  userId: string;
  hook: string;
  startIST: string;
  endIST: string;
  start?: number;
  limit?: number;
  onProgress?: (fetched: number, total: number, stage: string) => void;
}

export async function fetchCostSheetData(
  opts: FetchCostSheetOptions,
): Promise<CostSheetResult> {
  const { userId, hook, startIST, endIST, start = 0, limit = 500, onProgress } = opts;

  let allInvoices: RawInvoice[] = [];
  let totalCount = 0;
  let nextStart: number | null = start;
  let fetched = 0;

  // Step 1: Fetch all invoices in pages of 50
  onProgress?.(0, 0, "Fetching invoices...");

  while (nextStart !== null && fetched < limit) {
    const result = await fetchInvoicesByDateRange(userId, hook, startIST, endIST, nextStart);
    allInvoices.push(...result.items);
    totalCount = result.total;
    fetched += result.items.length;
    nextStart = result.next;

    onProgress?.(fetched, totalCount, "Fetching invoices...");

    if (result.items.length === 0) break;
  }

  if (allInvoices.length === 0) {
    return { rows: [], totalInvoices: 0, totalCount, nextStart: null };
  }

  // Trim to limit
  if (allInvoices.length > limit) {
    allInvoices = allInvoices.slice(0, limit);
  }

  const rows = await enrichRawInvoices(userId, hook, allInvoices, onProgress, fetched, totalCount);

  return {
    rows,
    totalInvoices: allInvoices.length,
    totalCount,
    nextStart,
  };
}

// ─── Shared Enrichment Pipeline ──────────────────────────────────────────────

export async function enrichRawInvoices(
  userId: string,
  hook: string,
  allInvoices: RawInvoice[],
  onProgress?: (fetched: number, total: number, stage: string) => void,
  fetched: number = 0,
  totalCount: number = 0,
): Promise<EnrichedRow[]> {
  if (allInvoices.length === 0) return [];

  // Step 2: Collect all unique IDs
  onProgress?.(fetched, totalCount, "Resolving references...");

  const patientIds = uniqueIds(allInvoices.map((i) => i.companyId));
  const dealIds = uniqueIds(allInvoices.map((i) => i.parentId2));
  const invoiceTypeIds = uniqueIds(allInvoices.map((i) => i.ufCrm_69CA54F0B8EAC));
  const iolIds = uniqueIds(allInvoices.map((i) => i.ufCrm_672EEAD954CF9));
  const paymentModeIds = uniqueIds(allInvoices.map((i) => i.ufCrm_682EB9C9759AE));
  const cashCollectedIds = uniqueIds(allInvoices.map((i) => i.ufCrm_686636FD83021));
  const counselorIds = uniqueIds(
    allInvoices.flatMap((i) => [i.ufCrm_619DF82A0B29B, i.assignedById]),
  );
  const invoiceIds = allInvoices.map((i) => i.id);

  // Step 3: Parallel bulk lookups
  onProgress?.(fetched, totalCount, "Enriching data...");

  const [patients, deals, invoiceTypes, iolLens, paymentModes, cashCollectedAt, counselors, products, hospitalLocs] =
    await Promise.all([
      bulkResolvePatients(userId, hook, patientIds),
      bulkResolveDeals(userId, hook, dealIds),
      bulkResolveListElements(userId, hook, 132, invoiceTypeIds),
      bulkResolveListElements(userId, hook, 94, iolIds),
      bulkResolveListElements(userId, hook, 110, paymentModeIds),
      bulkResolveListElements(userId, hook, 104, cashCollectedIds),
      bulkResolveUsers(userId, hook, counselorIds),
      fetchProductRows(userId, hook, invoiceIds),
      fetchHospitalLocations(userId, hook),
    ]);

  // Build location map from hospital locations list (IBLOCK 66)
  const locations = new Map<string, string>();
  hospitalLocs.forEach((loc: any) => {
    locations.set(String(loc.ID), loc.NAME);
  });

  // Step 4: Hydrate
  onProgress?.(fetched, totalCount, "Building cost sheet...");

  const caches: LookupCaches = {
    patients,
    deals,
    invoiceTypes,
    iolLens,
    paymentModes,
    cashCollectedAt,
    counselors,
    locations,
    products,
  };

  const rows = hydrateInvoices(allInvoices, caches);

  return rows;
}

// ─── Entity History ──────────────────────────────────────────────────────────

export async function fetchEntityHistory(
  userId: string,
  hook: string,
  entityType: "patient" | "deal",
  entityId: number,
): Promise<EnrichedRow[]> {
  const url = baseUrl(userId, hook);
  const filterKey = entityType === "patient" ? "=companyId" : "=parentId2";

  let allInvoices: RawInvoice[] = [];
  let nextStart: number | null = 0;

  while (nextStart !== null) {
    const res: Response = await fetch(`${url}/crm.item.list.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityTypeId: 31,
        select: INVOICE_SELECT_FIELDS,
        order: { createdTime: "DESC" },
        filter: { [filterKey]: entityId },
        start: nextStart,
      }),
    });

    const data = await res.json();
    const items = (data.result?.items || []) as RawInvoice[];
    allInvoices.push(...items);
    nextStart = data.next ?? null;

    if (items.length === 0) break;
  }

  return enrichRawInvoices(userId, hook, allInvoices);
}
