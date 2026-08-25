/**
 * Branded Type for Canonical UserId
 * Prevents domain coupling while maintaining strong type safety across Bounded Contexts.
 */
export type UserId = number & { readonly __brand: unique symbol };

export function createUserId(id: number): UserId {
  return id as UserId;
}
