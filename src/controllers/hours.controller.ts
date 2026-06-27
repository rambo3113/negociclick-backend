import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// GET /api/businesses/:id/hours — público
export const getHours = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const hours = await prisma.businessHours.findMany({
      where: { businessId: id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json({ success: true, hours });
  } catch {
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
};

// PUT /api/businesses/:id/hours — vendor owner only
// Body: [{ dayOfWeek, openTime, closeTime, isClosed }]
export const upsertHours = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId as string;
    const entries: { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }[] = req.body;

    if (!Array.isArray(entries) || entries.length === 0)
      return res.status(400).json({ error: 'Se requiere un array de horarios' });

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const results = await Promise.all(
      entries.map(e =>
        prisma.businessHours.upsert({
          where: { businessId_dayOfWeek: { businessId: id, dayOfWeek: e.dayOfWeek } },
          update: { openTime: e.openTime, closeTime: e.closeTime, isClosed: e.isClosed },
          create: { businessId: id, dayOfWeek: e.dayOfWeek, openTime: e.openTime, closeTime: e.closeTime, isClosed: e.isClosed },
        })
      )
    );

    res.json({ success: true, hours: results });
  } catch {
    res.status(500).json({ error: 'Error al guardar horarios' });
  }
};
