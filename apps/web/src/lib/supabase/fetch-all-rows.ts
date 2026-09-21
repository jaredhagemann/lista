/**
 * Reading a list completely (BUG-014).
 *
 * PostgREST caps every response at `max_rows` — 1,000 in this project, locally
 * and in production. A query that asks for "all the team's availability" simply
 * stops there, with no error and no indication that it did. The schedule,
 * availability matrix and club member list all did exactly that, and a missing
 * availability row renders as "no response": indistinguishable from a player who
 * never replied.
 *
 * This pages until a short page comes back, so completeness is a property of the
 * loop rather than a bet on staying under a limit that is invisible from the
 * call site. A failure part-way through raises rather than returning what it has:
 * half a roster looks exactly like a roster, which is the whole problem.
 */

export class PartialFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartialFetchError";
  }
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Pages below the API cap; the difference leaves room to notice a short page. */
const DEFAULT_PAGE_SIZE = 500;

/**
 * An upper bound on one screen's data. Reaching it means a query is broader than
 * any page should render, and returning silently truncated data would put us
 * back where we started.
 */
const DEFAULT_MAX_ROWS = 20_000;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  options: { pageSize?: number; maxRows?: number } = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error) {
      throw new PartialFetchError(
        `Could not read past row ${from}: ${error.message}`
      );
    }

    const page = data ?? [];
    rows.push(...page);

    // A short page is the end of the list: the only reliable signal, since a
    // full page might be the last one or might not.
    if (page.length < pageSize) return rows;

    if (rows.length >= maxRows) {
      throw new PartialFetchError(
        `Refusing to read more than ${maxRows} rows; narrow the query instead`
      );
    }
  }
}
