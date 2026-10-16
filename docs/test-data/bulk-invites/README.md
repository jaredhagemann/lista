# Bulk invite test data

CSV files for testing the team **Bulk invite** upload (spec: `docs/specs/bulk-invite.md`). Each one uses the
upload's column format: `first_name,last_name,email,role,birthday,gender`.

Every email is a `+` alias of `jaredhagemann.test@gmail.com`, so all invites land in that one inbox and can
be accepted from it, while the app still treats each address as a different person.

| File | Rows | Contents |
| --- | --- | --- |
| `boys-2016.csv` | 11 | 10 boys born 2016 + 1 coach |
| `boys-2017.csv` | 11 | 10 boys born 2017 + 1 coach |
| `girls-2016.csv` | 11 | 10 girls born 2016 + 1 coach |
| `girls-2017.csv` | 11 | 10 girls born 2017 + 1 coach |
| `girls-2018.csv` | 11 | 10 girls born 2018 + 1 coach |
| `u14-2013-numbered.csv` | 16 | "Player 1"–"Player 16", born 2013 (U14 for 2026–27), gender blank |

Re-uploading a file to the same team skips anyone already invited or on the roster. Each sent invite counts
toward Resend's 100 emails/day limit.
