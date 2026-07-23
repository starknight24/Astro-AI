import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in api/.env.");
}

export const pool = new pg.Pool({ connectionString });

export async function upsertUser(id: string, email: string): Promise<void> {
  await pool.query(
    "INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [id, email],
  );
}
