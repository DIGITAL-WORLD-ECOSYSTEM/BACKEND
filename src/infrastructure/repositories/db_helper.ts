export function isD1Database(db: any): boolean {
  const client = db?.session?.client || db?.$client;
  return Boolean(
    (client?.batch && typeof client?.prepare === 'function') ||
    typeof client?.dump === 'function' ||
    db?.session?.constructor?.name?.toLowerCase().includes('d1')
  );
}
