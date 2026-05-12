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
  deals: number;
  quantitySold: number;
  revenue: number;
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
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;
  try {
    const res = await fetch(`${baseUrl}/lists.element.get.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        IBLOCK_TYPE_ID: "lists",
        IBLOCK_ID: 66,
      }),
    });
    const data = await res.json();
    return data.result || [];
  } catch (error) {
    console.error("Error fetching hospital locations:", error);
    return [];
  }
}

export async function fetchBitrixData(
  userId: string,
  hook: string,
  month: number,
  year: number,
  filterLocationId?: string,
  start: number = 0,
  limit: number = 50,
  manualFieldId?: string,
  day?: number | "All",
) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;
  const startDay = day && day !== "All" ? day : 1;
  const endDay = day && day !== "All" ? day : new Date(year, month + 1, 0).getDate();
  
  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  try {
    const fieldsRes = await fetch(
      `${baseUrl}/crm.item.fields?entityTypeId=31&useOriginalUfNames=Y`,
    );
    const fieldsData = await fieldsRes.json();
    const locationMap: Record<string, string> = {};
    let actualLocationField = manualFieldId || "locationId";

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

      if (actualLocationField === "ufCrm_634952003E51B") {
        const hospitalLocs = await fetchHospitalLocations(userId, hook);
        hospitalLocs.forEach((loc: any) => {
          locationMap[loc.ID] = loc.NAME;
        });
      }
    }

    const filter: any = {
      ">=begindate": startDate,
      "<=begindate": endDate,
    };

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
          select: ["id", "title", "begindate", actualLocationField],
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

          const productRows = batchData.result.result[key]?.productRows;
          if (productRows) {
            const seenInThisInv = new Set<string>();
            productRows.forEach((row: any) => {
              const name = row.productName;
              const aggKey = `${locationName}_${name}`;
              if (!productAggregation[aggKey]) {
                productAggregation[aggKey] = {
                  name,
                  locationId: locationName,
                  deals: 0,
                  quantitySold: 0,
                   revenue: 0,
                  lastDate: "",
                };
              }
              productAggregation[aggKey].quantitySold += Number(row.quantity);
              productAggregation[aggKey].revenue += Number(row.priceBrutto);

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
        (a, b) => b.revenue - a.revenue,
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
  month: number,
  year: number,
  filterLocationId?: string,
  manualFieldId?: string,
  day?: number | "All",
) {
  const baseUrl = `https://crm.mantracare.com/rest/${userId}/${hook}`;
  const startDay = day && day !== "All" ? day : 1;
  const endDay = day && day !== "All" ? day : new Date(year, month + 1, 0).getDate();

  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  const filter: any = {
    ">=begindate": startDate,
    "<=begindate": endDate,
  };

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
