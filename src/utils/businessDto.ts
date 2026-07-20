/**
 * DTO helpers for Business API responses.
 *
 * toPublicBusiness — for unauthenticated / public endpoints.
 *   Strips: culqiSecretKeyEnc, culqiPublicKey, culqiKeysValidatedAt,
 *           email (business contact), owner relation,
 *           viewCount, featuredReminderSentAt, updatedAt, paymentInstructions
 *           (internal/operational fields with no public UI use).
 *   Keeps:  phone, address (clientes necesitan llamar/llegar).
 *
 * omitCulqiSecret — for owner / admin authenticated endpoints.
 *   Only strips culqiSecretKeyEnc; leaves everything else intact.
 */

export function toPublicBusiness<T extends Record<string, unknown>>(b: T) {
  const {
    culqiSecretKeyEnc:      _s,
    culqiPublicKey:         _p,
    culqiKeysValidatedAt:   _v,
    email:                  _e,
    owner:                  _o,
    ownerId:                _id,  // FK interna — no necesaria en clientes
    viewCount:              _vc,
    featuredReminderSentAt: _frs,
    updatedAt:              _ua,
    paymentInstructions:    _pi,
    ...pub
  } = b;
  return pub;
}

export function omitCulqiSecret<T extends Record<string, unknown>>(b: T) {
  const { culqiSecretKeyEnc: _s, ...rest } = b;
  return rest;
}
