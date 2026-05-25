const USER_ID = process.env.NEXT_PUBLIC_BITRIX_USER_ID;
const HOOK = process.env.NEXT_PUBLIC_BITRIX_HOOK_SECRET;

async function test() {
  const url = `https://b24-7wvsx9.bitrix24.in/rest/${USER_ID}/${HOOK}/crm.item.list.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityTypeId: 31,
      select: ["id", "title", "opportunity", "taxValue", "currencyId"],
      order: { createdTime: "DESC" },
      limit: 5
    }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

test();
