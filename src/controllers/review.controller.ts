import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { cacheGet, cacheSet, cacheKey, TTL, invalidateReviews } from '../lib/cache';
import { runAsync } from '../lib/asyncTask';

// Recalcula y guarda el rating promedio del negocio
async function recalculateBusinessRating(businessId: string) {
  const reviews = await prisma.review.findMany({
    where: { businessId },
    select: { rating: true }
  });

  const totalReviews = reviews.length;
  const rating = totalReviews > 0
    ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1))
    : null;

  await prisma.business.update({
    where: { id: businessId },
    data: { rating, totalReviews }
  });
}

// ============================================
// 1. CREAR RESEÑA (cliente con reserva completada)
// ============================================
export const createReview = async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId;
    const { bookingId, rating, comment } = req.body as {
      bookingId: string;
      rating: number;
      comment?: string;
    };

    if (!bookingId || !rating) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: bookingId, rating' });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'El rating debe ser un número entero entre 1 y 5' });
    }

    // Verificar que la reserva existe, pertenece al cliente y está completada
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (booking.clientId !== clientId) {
      return res.status(403).json({ error: 'Solo puedes reseñar tus propias reservas' });
    }

    if (booking.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Solo puedes reseñar reservas completadas' });
    }

    // Verificar que no exista ya una reseña para esta reserva
    const existing = await prisma.review.findUnique({ where: { bookingId } });
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una reseña para esta reserva' });
    }

    const review = await prisma.review.create({
      data: {
        rating,
        comment: comment || null,
        clientId,
        businessId: booking.businessId,
        bookingId
      },
      include: {
        client: { select: { name: true } },
        business: { select: { name: true } }
      }
    });

    runAsync('recalculate-rating', () => recalculateBusinessRating(booking.businessId));
    invalidateReviews(booking.businessId);

    res.status(201).json({
      success: true,
      message: 'Reseña creada exitosamente',
      review
    });

  } catch (error: any) {
    console.error('Error al crear reseña:', error);
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};

// ============================================
// 1b. CREAR RESEÑA VÍA RUTA /businesses/:id/reviews
//     No requiere bookingId en body — busca automáticamente
// ============================================
export const createBusinessReview = async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const businessId = String(req.params.id);
    const { rating, comment } = req.body as { rating: number; comment?: string };

    if (!rating) return res.status(400).json({ error: 'El campo rating es obligatorio' });
    if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'El rating debe ser un número entero entre 1 y 5' });
    }
    if (comment && comment.length > 500) {
      return res.status(400).json({ error: 'El comentario no puede superar 500 caracteres' });
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    // El dueño no puede reseñar su propio negocio
    if (business.ownerId === clientId) {
      return res.status(403).json({ error: 'No puedes reseñar tu propio negocio' });
    }

    // Ya existe una reseña de este usuario para este negocio
    const existingReview = await prisma.review.findFirst({ where: { businessId, clientId } });
    if (existingReview) {
      return res.status(409).json({ error: 'Ya dejaste una reseña para este negocio' });
    }

    // Buscar un booking completado y sin reseña de este cliente para este negocio
    const booking = await prisma.booking.findFirst({
      where: {
        clientId,
        businessId,
        status: 'COMPLETED',
        review: null,
      },
    });
    if (!booking) {
      return res.status(403).json({ error: 'Necesitas completar una reserva para dejar una reseña' });
    }

    const review = await prisma.review.create({
      data: {
        rating: Number(rating),
        comment: comment?.trim() || null,
        clientId,
        businessId,
        bookingId: booking.id,
      },
      include: { client: { select: { name: true, avatar: true } } },
    });

    runAsync('recalculate-rating', () => recalculateBusinessRating(businessId));
    invalidateReviews(businessId);

    res.status(201).json({ success: true, review });
  } catch (error: any) {
    console.error('Error al crear reseña:', error);
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};

// ============================================
// 2. RESEÑAS DE UN NEGOCIO (público)
// ============================================
export const getReviewsByBusiness = async (req: Request, res: Response) => {
  try {
    const businessId = (req.params.businessId ?? req.params.id) as string;
    const page  = Math.max(1, parseInt((req.query.page  as string) || '1'));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '10')));
    const skip  = (page - 1) * limit;

    // Solo cachea la primera página sin filtros adicionales
    const revCacheKey = cacheKey.reviews(businessId);
    if (page === 1 && limit === 10) {
      const cached = cacheGet<object>(revCacheKey);
      if (cached) return res.json(cached);
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const [reviews, total] = await prisma.$transaction([
      prisma.review.findMany({
        where: { businessId },
        include: { client: { select: { name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.review.count({ where: { businessId } }),
    ]);

    const payload = {
      success: true,
      count: total,
      page,
      totalPages: Math.ceil(total / limit),
      averageRating: business.rating,
      reviews,
    };

    if (page === 1 && limit === 10) {
      cacheSet(revCacheKey, payload, TTL.REVIEWS);
    }

    res.json(payload);

  } catch (error: any) {
    console.error('Error al obtener reseñas:', error);
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
};

// ============================================
// 3. MIS RESEÑAS (cliente autenticado)
// ============================================
export const getMyReviews = async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId;

    const reviews = await prisma.review.findMany({
      where: { clientId },
      include: {
        business: { select: { name: true, category: true, city: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: reviews.length, reviews });

  } catch (error: any) {
    console.error('Error al obtener mis reseñas:', error);
    res.status(500).json({ error: 'Error al obtener mis reseñas' });
  }
};

// ============================================
// 4. ACTUALIZAR RESEÑA (solo el autor)
// ============================================
export const updateReview = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const clientId = (req as any).userId;
    const { rating, comment } = req.body as { rating?: number; comment?: string };

    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'El rating debe ser un número entero entre 1 y 5' });
    }

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    if (review.clientId !== clientId) {
      return res.status(403).json({ error: 'Solo puedes editar tus propias reseñas' });
    }

    const updatedReview = await prisma.review.update({
      where: { id },
      data: {
        rating: rating ?? undefined,
        comment: comment ?? undefined
      }
    });

    runAsync('recalculate-rating', () => recalculateBusinessRating(review.businessId));
    invalidateReviews(review.businessId);

    res.json({
      success: true,
      message: 'Reseña actualizada exitosamente',
      review: updatedReview
    });

  } catch (error: any) {
    console.error('Error al actualizar reseña:', error);
    res.status(500).json({ error: 'Error al actualizar reseña' });
  }
};

// ============================================
// 5. ELIMINAR RESEÑA (autor o admin)
// ============================================
export const deleteReview = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const clientId = (req as any).userId;
    const userRole = (req as any).userRole;

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    if (review.clientId !== clientId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta reseña' });
    }

    await prisma.review.delete({ where: { id } });
    runAsync('recalculate-rating', () => recalculateBusinessRating(review.businessId));
    invalidateReviews(review.businessId);

    res.json({ success: true, message: 'Reseña eliminada exitosamente' });

  } catch (error: any) {
    console.error('Error al eliminar reseña:', error);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
};
