// The Supabase REST API caps a single select() at 1000 rows regardless of
// how many actually match, silently dropping the rest — fetch in pages
// until a page comes back short.
export async function fetchAllRows(supabase, table) {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
