export interface BitrixItem {
  id: number;
  [key: string]: any;
}

export interface ProductRow {
  id: number;
  ownerId: number;
  productName: string;
  quantity: number;
  price: number;
  priceBrutto: number;
  [key: string]: any;
}

export interface AggregatedProduct {
  name: string;
  locationId: string;
  paymentMode: string;
  deals: number;
  quantitySold: number;
  netRevenue: number;
  netPrice: number;
  lastDate: string;
}

export interface BitrixLocation {
  id: string;
  name: string;
}

const findLocationField = (fields: any) => {
  const targets = [
    "location",
    "area",
    "branch",
    "center",
    "hospital",
    "clinic",
    "office",
    "department",
    "unit",
    "place",
    "site",
    "facility",
  ];

  for (const [key, field] of Object.entries<any>(fields)) {
    const title = (field.title || "").toLowerCase();
    const isCustom = key.startsWith("ufCrm");
    const matchesTarget = targets.some((t) => title.includes(t));

    if (
      isCustom &&
      matchesTarget &&
      (field.items ||
        field.type === "enumeration" ||
        field.type === "crm_entity")
    ) {
      return key;
    }
  }

  for (const [key, field] of Object.entries<any>(fields)) {
    const title = (field.title || "").toLowerCase();
    if (title === "location" || title === "area" || title === "center")
      return key;
  }

  if (fields.locationId) return "locationId";

  const commonCustomIds = ["ufCrm_619DF8277477D", "ufCrm31_1714561433"];
  for (const id of commonCustomIds) {
    if (fields[id]) return id;
  }

  return null;
};

export async function fetchLocations(userId: string, hook: string) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;

  try {
    const fieldsRes = await fetch(`${baseUrl}/crm.item.fields?entityTypeId=31`);
    const fieldsData = await fieldsRes.json();

    if (fieldsData.result && fieldsData.result.fields) {
      const allFields = fieldsData.result.fields;

      const debugFields = Object.keys(allFields).map((key) => ({
        ID: key,
        Title: allFields[key].title,
        Type: allFields[key].type,
      }));
      console.log("--- ALL SMART INVOICE FIELDS ---");
      console.table(debugFields);

      const actualKey = findLocationField(allFields);

      if (actualKey && allFields[actualKey]) {
        const items = allFields[actualKey].items || [];
        console.log(
          `Detected Location Field: "${allFields[actualKey].title}" (${actualKey})`,
        );
        return items.map((item: any) => ({
          id: item.ID,
          name: item.VALUE,
        })) as BitrixLocation[];
      }
    }
    console.warn("No location-related field found in Smart Invoices");
    return [];
  } catch (error) {
    console.error("Error fetching locations:", error);
    return [];
  }
}

export async function fetchHospitalLocations(userId: string, hook: string) {
  return fetchListElements(userId, hook, 66);
}

export async function fetchListElements(userId: string, hook: string, iblockId: number) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;
  try {
    const res = await fetch(`${baseUrl}/lists.element.get.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        IBLOCK_TYPE_ID: "lists",
        IBLOCK_ID: iblockId,
      }),
    });
    const data = await res.json();
    return data.result || [];
  } catch (error) {
    console.error(`Error fetching list elements for IBLOCK ${iblockId}:`, error);
    return [];
  }
}

export async function fetchBitrixData(
  userId: string,
  hook: string,
  startDate: string,
  endDate: string,
  filterLocationId?: string,
  start: number = 0,
  limit: number = 50,
  manualFieldId?: string,
  invoiceType?: string,
  createdAt?: string,
) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;

  try {
    const fieldsRes = await fetch(
      `${baseUrl}/crm.item.fields?entityTypeId=31&useOriginalUfNames=Y`,
    );
    const fieldsData = await fieldsRes.json();
    const locationMap: Record<string, string> = {};
    let actualLocationField = manualFieldId || "locationId";

    const paymentModeMapEnum1: Record<string, string> = {};
    const paymentModeMapEnum2: Record<string, string> = {};
    const paymentModeMapIblock: Record<string, string> = {};

    if (fieldsData.result && fieldsData.result.fields) {
      const allFields = fieldsData.result.fields;
      if (!manualFieldId) {
        actualLocationField = findLocationField(allFields) || "locationId";
      }

      if (allFields[actualLocationField]) {
        const items = allFields[actualLocationField].items || [];
        items.forEach((item: any) => {
          locationMap[item.ID] = item.VALUE;
        });
      }

      if (allFields["ufCrm_619DF828AB6E7"]) {
        const items = allFields["ufCrm_619DF828AB6E7"].items || [];
        items.forEach((item: any) => { paymentModeMapEnum1[item.ID] = item.VALUE; });
      }
      if (allFields["ufCrm_682EB9C9607BE"]) {
        const items = allFields["ufCrm_682EB9C9607BE"].items || [];
        items.forEach((item: any) => { paymentModeMapEnum2[item.ID] = item.VALUE; });
      }

      if (actualLocationField === "ufCrm_634952003E51B") {
        const hospitalLocs = await fetchHospitalLocations(userId, hook);
        hospitalLocs.forEach((loc: any) => {
          locationMap[loc.ID] = loc.NAME;
        });
      }
    }

    // Fetch Payment Modes Iblock
    try {
      const paymentModesList = await fetchListElements(userId, hook, 110);
      paymentModesList.forEach((loc: any) => {
        paymentModeMapIblock[loc.ID] = loc.NAME;
      });
    } catch (e) {
      console.error("Error fetching payment modes iblock", e);
    }

    const filter: any = {
      ">=begindate": startDate,
      "<=begindate": endDate,
    };

    if (invoiceType && invoiceType !== "All") {
      filter["ufCrm_69CA54F0B8EAC"] = invoiceType;
    }

    if (createdAt && createdAt !== "All") {
      filter["ufCrm_686636FD83021"] = createdAt;
    }

    if (filterLocationId && filterLocationId !== "All") {
      filter[actualLocationField] = filterLocationId;
    }

    let allInvoices: BitrixItem[] = [];
    let totalCount = 0;
    let nextStart: number | null = null;

    const pagesToFetch = Math.ceil(limit / 50);

    if (pagesToFetch === 1) {
      const res = await fetch(`${baseUrl}/crm.item.list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityTypeId: 31,
          select: ["id", "title", "begindate", actualLocationField, "ufCrm_619DF828AB6E7", "ufCrm_682EB9C9607BE", "ufCrm_682EB9C9759AE"],
          filter,
          order: { begindate: "DESC" },
          start,
        }),
      });
      const data = await res.json();
      allInvoices = data.result?.items || [];
      totalCount = data.total || 0;
      nextStart = data.next || null;
    } else {
      const batchCmd: Record<string, string> = {};
      for (let i = 0; i < pagesToFetch; i++) {
        const pageStart = start + i * 50;
        const params = new URLSearchParams();
        params.append("entityTypeId", "31");
        params.append("select[0]", "id");
        params.append("select[1]", "title");
        params.append("select[2]", "begindate");
        params.append("select[3]", actualLocationField);
        params.append("select[4]", "ufCrm_619DF828AB6E7");
        params.append("select[5]", "ufCrm_682EB9C9607BE");
        params.append("select[6]", "ufCrm_682EB9C9759AE");
        Object.keys(filter).forEach((k) =>
          params.append(`filter[${k}]`, filter[k]),
        );
        params.append("start", pageStart.toString());
        batchCmd[`p${i}`] = `crm.item.list?${params.toString()}`;
      }

      const batchRes = await fetch(`${baseUrl}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halt: 0, cmd: batchCmd }),
      });
      const batchData = await batchRes.json();

      if (batchData.result && batchData.result.result) {
        for (let i = 0; i < pagesToFetch; i++) {
          const res = batchData.result.result[`p${i}`];
          if (res && res.items) {
            allInvoices.push(...res.items);
            if (res.total !== undefined) totalCount = res.total;
            if (res.next !== undefined) nextStart = res.next;
          }
        }
      }

      if (
        nextStart === null &&
        allInvoices.length >= limit &&
        allInvoices.length > 0
      ) {
        nextStart = start + allInvoices.length;
      }
    }

    if (allInvoices.length === 0) {
      return { products: [], totalInvoices: 0, totalCount, nextStart: null };
    }

    const productAggregation: Record<string, AggregatedProduct> = {};
    const CHUNK_SIZE = 50;

    let detectedField = actualLocationField;
    if (allInvoices.length > 0) {
      const firstInv = allInvoices[0];
      const hasValue = (val: any) =>
        val !== null && val !== undefined && val !== "";

      if (!hasValue(firstInv[detectedField])) {
        const anyPopulatedField = Object.keys(firstInv).find(
          (k) => k.startsWith("ufCrm") && hasValue(firstInv[k]),
        );
        if (anyPopulatedField) {
          detectedField = anyPopulatedField;
          console.log(
            `Auto-switched location field to ${detectedField} because it has data.`,
          );
        }
      }
      console.log("Available invoice fields:", Object.keys(firstInv));
    }

    const prodBatchRequests = [];
    for (let i = 0; i < allInvoices.length; i += CHUNK_SIZE) {
      const chunk = allInvoices.slice(i, i + CHUNK_SIZE);
      const batchCmd: Record<string, string> = {};
      chunk.forEach((inv) => {
        batchCmd[`inv_${inv.id}`] =
          `crm.item.productrow.list?filter%5B%3DownerType%5D=SI&filter%5B%3DownerId%5D=${inv.id}`;
      });
      prodBatchRequests.push(
        fetch(`${baseUrl}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ halt: 0, cmd: batchCmd }),
        }).then((res) => res.json()),
      );
    }

    const allProdResults = await Promise.all(prodBatchRequests);
    allProdResults.forEach((batchData) => {
      if (batchData.result && batchData.result.result) {
        Object.keys(batchData.result.result).forEach((key) => {
          const invId = key.split("_")[1];
          const invoice = allInvoices.find(
            (inv) => inv.id.toString() === invId,
          );
          const rawLocId = invoice?.[detectedField];

          let locationName = "Other";
          if (rawLocId) {
            locationName = locationMap[rawLocId] || `Area: ${rawLocId}`;
          }

          let payMode = "Unknown";
          const pm1 = invoice?.["ufCrm_682EB9C9759AE"];
          const pm2 = invoice?.["ufCrm_619DF828AB6E7"];
          const pm3 = invoice?.["ufCrm_682EB9C9607BE"];

          if (pm1 && paymentModeMapIblock[pm1]) {
            payMode = paymentModeMapIblock[pm1];
          } else if (pm2 && paymentModeMapEnum1[pm2]) {
            payMode = paymentModeMapEnum1[pm2];
          } else if (pm3 && paymentModeMapEnum2[pm3]) {
            payMode = paymentModeMapEnum2[pm3];
          }

          const productRows = batchData.result.result[key]?.productRows;
          if (productRows) {
            const seenInThisInv = new Set<string>();
            productRows.forEach((row: any) => {
              const name = row.productName;
              const aggKey = `${locationName}_${name}_${payMode}`;
              if (!productAggregation[aggKey]) {
                productAggregation[aggKey] = {
                  name,
                  locationId: locationName,
                  paymentMode: payMode,
                  deals: 0,
                  quantitySold: 0,
                  netRevenue: 0,
                  netPrice: 0,
                  lastDate: "",
                };
              }
              productAggregation[aggKey].quantitySold += Number(row.quantity);
              productAggregation[aggKey].netRevenue += Number(row.price) * Number(row.quantity);
              
              // Update average net price
              if (productAggregation[aggKey].quantitySold > 0) {
                productAggregation[aggKey].netPrice = productAggregation[aggKey].netRevenue / productAggregation[aggKey].quantitySold;
              }

              const invDate = invoice?.begindate
                ? new Date(invoice.begindate).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })
                : "";

              if (invDate) {
                productAggregation[aggKey].lastDate = invDate;
              }

              seenInThisInv.add(aggKey);
            });
            seenInThisInv.forEach((k) => (productAggregation[k].deals += 1));
          }
        });
      }
    });

    return {
      products: Object.values(productAggregation).sort(
        (a, b) => b.netRevenue - a.netRevenue,
      ),
      totalInvoices: allInvoices.length,
      totalCount: totalCount,
      nextStart: nextStart,
    };
  } catch (error) {
    console.error("Bitrix fetch error:", error);
    throw error;
  }
}

export async function fetchTotalCount(
  userId: string,
  hook: string,
  startDate: string,
  endDate: string,
  filterLocationId?: string,
  manualFieldId?: string,
  invoiceType?: string,
  createdAt?: string,
) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;

  const filter: any = {
    ">=begindate": startDate,
    "<=begindate": endDate,
  };

  if (invoiceType && invoiceType !== "All") {
    filter["ufCrm_69CA54F0B8EAC"] = invoiceType;
  }

  if (createdAt && createdAt !== "All") {
    filter["ufCrm_686636FD83021"] = createdAt;
  }

  if (filterLocationId && filterLocationId !== "All") {
    const field = manualFieldId || "locationId";
    filter[field] = filterLocationId;
  }

  try {
    const res = await fetch(`${baseUrl}/crm.item.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityTypeId: 31,
        select: ["id"],
        filter,
        limit: 1,
      }),
    });
    const data = await res.json();
    return data.total || 0;
  } catch (error) {
    console.error("Error fetching total count:", error);
    return 0;
  }
}
