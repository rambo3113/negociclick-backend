import { Request, Response } from 'express';
import prisma from '../lib/prisma';

/**
 * Public: Get active featured businesses for homepage slider
 * GET /api/featured-businesses
 */
export const getFeaturedBusinesses = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // Obtener negocios destacados cuya suscripción sigue vigente
    const featuredBusinesses = await prisma.business.findMany({
      where: {
        featured: true,
        featuredUntil: {
          gt: now, // featuredUntil > NOW
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        city: true,
        phone: true,
        address: true,
        orderMode: true,
        photos: {
          select: {
            url: true,
            caption: true,
            order: true,
          },
          take: 1,
          orderBy: { order: 'asc' }, // primera foto (order 0)
        },
      },
      orderBy: {
        featuredUntil: 'desc', // Los que expiran más tarde aparecen primero
      },
      take: 20, // máximo 20 negocios en slider
    });

    // Si no hay negocios destacados, retornar array vacío
    if (featuredBusinesses.length === 0) {
      return res.status(200).json({
        success: true,
        featured: [],
        message: 'No hay negocios destacados en este momento',
      });
    }

    // Mapear respuesta
    const response = featuredBusinesses.map(b => ({
      id: b.id,
      name: b.name,
      description: b.description,
      category: b.category,
      city: b.city,
      phone: b.phone,
      address: b.address,
      orderMode: b.orderMode,
      photo: b.photos[0]?.url || null, // primera foto o null
      photoCaption: b.photos[0]?.caption || b.name,
    }));

    return res.status(200).json({
      success: true,
      featured: response,
      count: response.length,
    });
  } catch (error) {
    console.error('[getFeaturedBusinesses] Error:', error);
    return res.status(500).json({ error: 'Error al obtener negocios destacados' });
  }
};
