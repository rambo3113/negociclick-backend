// src/controllers/business.controller.ts
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import {
  cacheGet, cacheSet, cacheKey, TTL,
  invalidateBusiness,
} from '../lib/cache';
import { runAsync } from '../lib/asyncTask';
import { toPublicBusiness, omitCulqiSecret } from '../utils/businessDto';

// ============================================
// 1. CREAR UN NEGOCIO
// ============================================
// Categorías de "pedido de producto" (repostería, flores...) vs. citas con agenda
const ORDER_CATEGORIES = new Set([
  'REPOSTERIA',
  'FLORES',
  'CATERING',
  'TEJIDOS_CROCHET',
  'DECORACION_EVENTOS',
]);

export const createBusiness = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const rawBody = req.body;
    const name        = rawBody.name?.trim();
    const description = rawBody.description?.trim() || null;
    const slogan      = rawBody.slogan?.trim() || null;
    const category    = rawBody.category?.trim();
    const address     = rawBody.address?.trim();
    const city        = rawBody.city?.trim();
    const phone       = rawBody.phone?.trim();
    const email       = rawBody.email?.trim().toLowerCase() || null;
    const { latitude, longitude } = rawBody;

    // Validar campos obligatorios
    if (!name || !category || !address || !city || !phone) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios: name, category, address, city, phone'
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'El formato del correo electrónico no es válido' });
    }

    // Verificar que el usuario sea VENDOR o ADMIN
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.role !== 'VENDOR' && user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Solo los vendedores pueden crear negocios. Actualiza tu rol a VENDOR.'
      });
    }

    if (user.role === 'VENDOR' && !user.emailVerified) {
      return res.status(403).json({
        error: 'Debes verificar tu correo electrónico antes de crear un negocio. Revisa tu bandeja de entrada.'
      });
    }

    // Plan FREE: máximo 1 negocio
    if (user.role !== 'ADMIN') {
      const existingCount = await prisma.business.count({ where: { ownerId: userId, isActive: true } });
      if (existingCount >= 1) {
        return res.status(403).json({ error: 'Solo puedes tener 1 negocio por cuenta.' });
      }
    }

    // Crear el negocio
    const business = await prisma.business.create({
      data: {
        name,
        description: description || null,
        slogan: slogan || null,
        category,
        orderMode: ORDER_CATEGORIES.has(category) ? 'ORDER' : 'APPOINTMENT',
        address,
        city,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        phone,
        email: email || null,
        ownerId: userId
      }
    });

    res.status(201).json({
      success: true,
      message: 'Negocio creado exitosamente',
      business: omitCulqiSecret(business as any)
    });

  } catch (error) {
    console.error('Error al crear negocio:', error);
    res.status(500).json({ error: 'Error al crear negocio' });
  }
};

// ============================================
// 2. LISTAR TODOS LOS NEGOCIOS (con filtros)
// ============================================
export const getAllBusinesses = async (req: Request, res: Response) => {
  try {
    const { category, city, search, minRating, minPrice, maxPrice, sortBy, page, limit } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page  || '1'));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20')));
    const skip = (pageNum - 1) * limitNum;

    // sortBy: 'featured' (default) | 'rating' | 'price_asc' | 'price_desc' | 'newest' | 'popular'
    const validSort = ['featured', 'rating', 'price_asc', 'price_desc', 'newest', 'popular'];
    const sort = validSort.includes(sortBy) ? sortBy : 'featured';

    const cacheKeyStr = `${category||''}:${city||''}:${minRating||''}:${minPrice||''}:${maxPrice||''}:${sort}:${pageNum}:${limitNum}`;

    if (!search) {
      const cached = cacheGet<object>(cacheKey.businessList(cacheKeyStr));
      if (cached) return res.json(cached);
    }

    const where = {
      isActive: true,
      ...(category && category !== 'TODOS' ? { category } : {}),
      ...(city     && city     !== 'TODAS' ? { city }     : {}),
      ...(minRating ? { rating: { gte: parseFloat(minRating) } } : {}),
      ...(search ? {
        OR: [
          { name:        { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { services: { some: { name: { contains: search, mode: 'insensitive' as const }, isActive: true } } },
        ],
      } : {}),
      ...((minPrice || maxPrice) ? {
        services: { some: {
          isActive: true,
          price: {
            ...(minPrice ? { gte: parseFloat(minPrice) } : {}),
            ...(maxPrice ? { lte: parseFloat(maxPrice) } : {}),
          },
        } },
      } : {}),
    };

    // Ordenamiento en DB cuando es posible; rating/price se ordenan en memoria post-fetch
    const dbOrderBy: object[] =
      sort === 'newest'   ? [{ createdAt: 'desc' }] :
      sort === 'popular'  ? [{ viewCount: 'desc' }, { featured: 'desc' }] :
                            [{ featured: 'desc' }, { createdAt: 'desc' }];

    const [businesses, total] = await Promise.all([
      prisma.business.findMany({
        where,
        include: {
          services: { where: { isActive: true } },
          reviews:  { select: { rating: true } },
        },
        orderBy: dbOrderBy,
        skip,
        take: limitNum,
      }),
      prisma.business.count({ where }),
    ]);

    let result = businesses.map(b => {
      const totalReviews = b.reviews.length;
      const averageRating = totalReviews > 0
        ? Number((b.reviews.reduce((s, r) => s + r.rating, 0) / totalReviews).toFixed(1))
        : null;
      const minSvcPrice = b.services.length > 0 ? Math.min(...b.services.map(s => Number(s.price))) : null;
      const now = new Date();
      const isFeatured = b.featured && !!b.featuredUntil && b.featuredUntil > now;
      return toPublicBusiness({ ...b, averageRating, totalReviews, minPrice: minSvcPrice, featured: isFeatured });
    });

    // Ordenamiento en memoria para rating y precio (requiere datos calculados)
    if (sort === 'rating') {
      result.sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0));
    } else if (sort === 'price_asc') {
      result.sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
    } else if (sort === 'price_desc') {
      result.sort((a, b) => (b.minPrice ?? 0) - (a.minPrice ?? 0));
    }

    const payload = {
      success: true,
      count: result.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      businesses: result,
    };

    if (!search) {
      cacheSet(cacheKey.businessList(cacheKeyStr), payload, TTL.BUSINESS_LIST);
    }

    res.json(payload);
  } catch (error) {
    console.error('Error al listar negocios:', error);
    res.status(500).json({ error: 'Error al listar negocios' });
  }
};

// ============================================
// 3. OBTENER UN NEGOCIO POR ID
// ============================================
export const getBusinessById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const bizCacheKey = cacheKey.business(id);
    const cached = cacheGet<object>(bizCacheKey);
    if (cached) return res.json(cached);

    const business = await prisma.business.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            name: true,
            avatar: true,
          }
        },
        services: {
          where: { isActive: true },
          orderBy: [{ createdAt: 'asc' }],
        } as any,
        subcategories: {
          orderBy: [{ category: 'asc' }, { position: 'asc' }, { name: 'asc' }],
        } as any,
        reviews: {
          include: {
            client: { select: { id: true, name: true, avatar: true } }
          },
          orderBy: { createdAt: 'desc' as const },
          take: 5,
        }
      }
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Calcular rating promedio
    const totalReviews = business.reviews.length;
    const averageRating = totalReviews > 0
      ? business.reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / totalReviews
      : null;

    // Plan activo del propietario
    const ownerSubscription = await prisma.subscription.findFirst({
      where: { userId: business.ownerId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
    const ownerPlan = ownerSubscription?.plan ?? 'FREE';

    // Pago online activo: PREMIUM + llaves validadas
    const onlinePaymentEnabled = !!(
      ownerPlan === 'PREMIUM' &&
      business.culqiPublicKey &&
      business.culqiKeysValidatedAt
    );

    // culqiSecretKeyEnc y culqiKeysValidatedAt NUNCA salen al cliente.
    // email del negocio tampoco es público.
    // culqiPublicKey solo si el pago online está activo (el frontend la necesita para checkout).
    const {
      culqiSecretKeyEnc: _s,
      culqiKeysValidatedAt: _v,
      culqiPublicKey: _pk,
      email: _email,
      ...businessPublic
    } = business as any;

    const payload = {
      success: true,
      business: {
        ...businessPublic,
        ownerPlan,
        onlinePaymentEnabled,
        culqiPublicKey: onlinePaymentEnabled ? business.culqiPublicKey : null,
        averageRating: averageRating ? Number(averageRating.toFixed(1)) : null,
        totalReviews
      }
    };
    cacheSet(bizCacheKey, payload, TTL.BUSINESS);

    res.json(payload);
  } catch (error) {
    console.error('Error al obtener negocio:', error);
    res.status(500).json({ error: 'Error al obtener negocio' });
  }
};

// ============================================
// 4. SUBIR FOTO DE PORTADA (PRO/PREMIUM)
// ============================================
export const uploadCoverImage = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId as string;

    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    // Eliminar portada anterior de Cloudinary si existe
    if (business.coverImage && business.coverImage.includes('res.cloudinary.com')) {
      const oldPublicId = extractPublicId(business.coverImage);
      if (oldPublicId) runAsync('delete-cloudinary', () => deleteFromCloudinary(oldPublicId));
    }

    const { url: coverImage } = await uploadToCloudinary(req.file.buffer);
    const updated = await prisma.business.update({
      where: { id },
      data: { coverImage },
    });

    invalidateBusiness(id);
    res.json({ success: true, coverImage: updated.coverImage });
  } catch {
    res.status(500).json({ error: 'Error al subir foto de portada' });
  }
};

// ============================================
// 5. ACTUALIZAR PERFIL PRO (slogan + descripción + heroBannerImageUrl)
// ============================================
export const updateBusinessProfile = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId as string;
    const { slogan, description, heroBannerImageUrl } = req.body as {
      slogan?: string;
      description?: string;
      heroBannerImageUrl?: string | null;
    };

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    if (description !== undefined && description.length > 500) {
      return res.status(400).json({ error: 'La descripción no puede superar 500 caracteres' });
    }

    const updated = await prisma.business.update({
      where: { id },
      data: {
        slogan: slogan !== undefined ? slogan : undefined,
        description: description !== undefined ? description : undefined,
        heroBannerImageUrl: heroBannerImageUrl !== undefined ? heroBannerImageUrl : undefined,
      },
    });

    invalidateBusiness(id);
    res.json({ success: true, business: omitCulqiSecret(updated as any) });
  } catch {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
};

// ============================================
// 5b. SUBIR HERO BANNER
// ============================================
export const uploadHeroBanner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId as string;

    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    if (business.heroBannerImageUrl && business.heroBannerImageUrl.includes('res.cloudinary.com')) {
      const oldPublicId = extractPublicId(business.heroBannerImageUrl);
      if (oldPublicId) runAsync('delete-cloudinary-hero', () => deleteFromCloudinary(oldPublicId));
    }

    const { url: heroBannerImageUrl } = await uploadToCloudinary(req.file.buffer);
    await prisma.business.update({ where: { id }, data: { heroBannerImageUrl } });

    invalidateBusiness(id);
    res.json({ success: true, heroBannerImageUrl });
  } catch {
    res.status(500).json({ error: 'Error al subir el hero banner' });
  }
};

// ============================================
// 6. ACTUALIZAR UN NEGOCIO
// ============================================
export const updateBusiness = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const { name, description, category, address, city, latitude, longitude, phone, email, isActive } = req.body;

    // Verificar que el negocio existe
    const existingBusiness = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Verificar que el usuario sea el propietario o ADMIN
    if (existingBusiness.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({
        error: 'No tienes permiso para actualizar este negocio'
      });
    }

    // Actualizar el negocio
    const updatedBusiness = await prisma.business.update({
      where: { id },
      data: {
        name: name || undefined,
        description: description || undefined,
        category: category || undefined,
        orderMode: category ? (ORDER_CATEGORIES.has(category) ? 'ORDER' : 'APPOINTMENT') : undefined,
        address: address || undefined,
        city: city || undefined,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        phone: phone || undefined,
        email: email || undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    invalidateBusiness(id);

    res.json({
      success: true,
      message: 'Negocio actualizado exitosamente',
      business: omitCulqiSecret(updatedBusiness as any)
    });

  } catch (error) {
    console.error('Error al actualizar negocio:', error);
    res.status(500).json({ error: 'Error al actualizar negocio' });
  }
};

// ============================================
// 7. MIS NEGOCIOS (vendor/admin)
// ============================================
export const getMyBusinesses = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const businesses = await prisma.business.findMany({
      where: { ownerId: userId, isActive: true },
      include: {
        services: { where: { isActive: true } },
        reviews: { select: { rating: true } },
        _count: { select: { bookings: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const result = businesses.map((b: typeof businesses[0]) =>
      omitCulqiSecret({
        ...b,
        averageRating: b.reviews.length > 0
          ? Number((b.reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / b.reviews.length).toFixed(1))
          : null,
        totalReviews: b.reviews.length,
      } as any)
    );

    res.json({ success: true, count: result.length, businesses: result });

  } catch (error) {
    console.error('Error al obtener mis negocios:', error);
    res.status(500).json({ error: 'Error al obtener mis negocios' });
  }
};

// ============================================
// 8. ELIMINAR UN NEGOCIO (Soft Delete)
// ============================================
export const deleteBusiness = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;

    // Verificar que el negocio existe
    const existingBusiness = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Verificar que el usuario sea el propietario o ADMIN
    if (existingBusiness.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({
        error: 'No tienes permiso para eliminar este negocio'
      });
    }

    // Soft delete (desactivar en lugar de eliminar)
    const deletedBusiness = await prisma.business.update({
      where: { id },
      data: { isActive: false }
    });

    invalidateBusiness(id);
    res.json({
      success: true,
      message: 'Negocio eliminado exitosamente',
      business: omitCulqiSecret(deletedBusiness as any)
    });

  } catch (error) {
    console.error('Error al eliminar negocio:', error);
    res.status(500).json({ error: 'Error al eliminar negocio' });
  }
};

// DELIVERY SYSTEM — ULTRA SIMPLE
export const getDeliveryMethods = async (req: Request, res: Response) => {
  try {
    const methods: any = {
      pickup: {
        enabled: true,
        cost: 0,
      },
      delivery: {
        enabled: true,
        zones: [
          { id: 'miraflores', name: 'Miraflores', cost: 15 },
          { id: 'surco', name: 'Surco', cost: 18 },
          { id: 'la-molina', name: 'La Molina', cost: 20 },
          { id: 'san-isidro', name: 'San Isidro', cost: 15 },
          { id: 'breña', name: 'Breña', cost: 25 },
        ],
      },
    };

    return res.json({ success: true, methods });
  } catch (error) {
    console.error('Error getDeliveryMethods:', error);
    return res.status(500).json({ error: 'Error al obtener métodos de delivery' });
  }
};