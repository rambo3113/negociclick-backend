import NodeCache from 'node-cache';

// TTLs en segundos
const TTL = {
  SUBSCRIPTION: 60,       // planGuard — se invalida al pagar/cancelar
  BUSINESS_LIST: 300,     // home y búsqueda pública — 5 min
  BUSINESS: 300,          // perfil de negocio — 5 min
  SERVICES: 300,          // servicios de un negocio — 5 min
  REVIEWS: 600,           // reseñas — 10 min
  HOURS: 1800,            // horarios — 30 min (casi estáticos)
};

const store = new NodeCache({ stdTTL: 0, useClones: false });

// ── Keys ────────────────────────────────────────────────────────────────────

export const cacheKey = {
  subscription:  (userId: string)     => `sub:${userId}`,
  businessList:  (params: string)     => `biz:list:${params}`,
  business:      (id: string)         => `biz:${id}`,
  services:      (businessId: string) => `svc:${businessId}`,
  reviews:       (businessId: string) => `rev:${businessId}`,
  hours:         (businessId: string) => `hrs:${businessId}`,
};

// ── Get / set genérico ──────────────────────────────────────────────────────

export function cacheGet<T>(key: string): T | undefined {
  return store.get<T>(key);
}

export function cacheSet<T>(key: string, value: T, ttl: number): void {
  store.set(key, value, ttl);
}

// ── Invalidación por dominio ────────────────────────────────────────────────

export function invalidateSubscription(userId: string) {
  store.del(cacheKey.subscription(userId));
}

export function invalidateBusiness(businessId: string) {
  store.del(cacheKey.business(businessId));
  store.del(cacheKey.services(businessId));
  store.del(cacheKey.reviews(businessId));
  store.del(cacheKey.hours(businessId));
  // Invalida todas las listas públicas de negocios
  const listKeys = store.keys().filter(k => k.startsWith('biz:list:'));
  store.del(listKeys);
}

export function invalidateServices(businessId: string) {
  store.del(cacheKey.services(businessId));
  // Las listas públicas podrían mostrar conteo de servicios
  const listKeys = store.keys().filter(k => k.startsWith('biz:list:'));
  store.del(listKeys);
}

export function invalidateReviews(businessId: string) {
  store.del(cacheKey.reviews(businessId));
  store.del(cacheKey.business(businessId)); // el rating está en el perfil
  const listKeys = store.keys().filter(k => k.startsWith('biz:list:'));
  store.del(listKeys);
}

export function invalidateHours(businessId: string) {
  store.del(cacheKey.hours(businessId));
}

// ── Stats (útil para debug/admin) ──────────────────────────────────────────

export function cacheStats() {
  return store.getStats();
}

export { TTL };
