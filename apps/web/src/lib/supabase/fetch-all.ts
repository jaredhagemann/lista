type Page<T> = { data: T[] | null; error: unknown };

/**
 * Every row of a read, across pages: the server caps each response, and leaves
 * the rest out without saying so. `page` must order by something unique, so rows
 * can't shift between pages. It continues until a page comes back empty, as the
 * cap may be smaller than the size asked for.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 1000,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  while (true) {
    const { data, error } = await page(rows.length, rows.length + pageSize - 1);
    if (error) return { data: [], error };
    if (!data || data.length === 0) return { data: rows, error: null };
    rows.push(...data);
  }
}
