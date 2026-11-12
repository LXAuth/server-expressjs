import type { Db } from "../db/pool.js";
import { HttpError } from "../http/errors.js";

export interface Profile {
  name_id: string | null;
  name_display: string | null;
  avatar_url: string | null;
}

export async function getProfile(db: Db, accountId: string): Promise<Profile> {
  const { rows } = await db.query<Profile>(
    "SELECT name_id, name_display, avatar_url FROM account_property WHERE account_id = $1",
    [accountId],
  );
  return rows[0] ?? { name_id: null, name_display: null, avatar_url: null };
}

export async function updateProfile(
  db: Db,
  accountId: string,
  input: { name_id?: string | null | undefined; name_display?: string | null | undefined; avatar_url?: string | null | undefined },
): Promise<void> {
  try {
    await db.query(
      `UPDATE account_property
          SET name_id      = CASE WHEN $2::boolean THEN $3 ELSE name_id END,
              name_display = CASE WHEN $4::boolean THEN $5 ELSE name_display END,
              avatar_url   = CASE WHEN $6::boolean THEN $7 ELSE avatar_url END
        WHERE account_id = $1`,
      [
        accountId,
        input.name_id !== undefined,
        input.name_id ?? null,
        input.name_display !== undefined,
        input.name_display ?? null,
        input.avatar_url !== undefined,
        input.avatar_url ?? null,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, "That name_id is taken");
    throw err;
  }
}
