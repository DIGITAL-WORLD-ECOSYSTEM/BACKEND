export function isD1Database(db: any): boolean {
  return Boolean(
    db?.session?.client?.batch ||
    db?.$client?.batch ||
    typeof db?.session?.client?.dump === 'function' ||
    db?.session?.constructor?.name?.toLowerCase().includes('d1')
  );
}
