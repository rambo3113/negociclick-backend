import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// GET /api/businesses/:id/availability — público
export const getAvailabilityBlocks = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.id as string;
    const blocks = await prisma.availabilityBlock.findMany({
      where: { businessId, endDate: { gte: new Date() } },
      orderBy: { startDate: 'asc' },
    });
    res.json({ success: true, blocks });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener bloques de disponibilidad' });
  }
};

// POST /api/businesses/:id/availability — solo vendor dueño
export const createAvailabilityBlock = async (req: Request, res: Response) => {
  try {
    const vendorId   = (req as any).userId as string;
    const businessId = req.params.id as string;
    const { startDate, endDate, reason } = req.body as { startDate: string; endDate: string; reason?: string };

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate y endDate son requeridos' });
    }
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la de fin' });
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== vendorId) return res.status(403).json({ error: 'No tienes permiso' });

    const block = await prisma.availabilityBlock.create({
      data: { businessId, startDate: new Date(startDate), endDate: new Date(endDate), reason: reason || null },
    });
    res.status(201).json({ success: true, block });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear bloque de disponibilidad' });
  }
};

// DELETE /api/businesses/:id/availability/:blockId — solo vendor dueño
export const deleteAvailabilityBlock = async (req: Request, res: Response) => {
  try {
    const vendorId   = (req as any).userId as string;
    const businessId = req.params.id as string;
    const blockId    = req.params.blockId as string;

    const block = await prisma.availabilityBlock.findUnique({ where: { id: blockId } });
    if (!block) return res.status(404).json({ error: 'Bloque no encontrado' });
    if (block.businessId !== businessId) return res.status(400).json({ error: 'El bloque no pertenece a este negocio' });

    const business = await prisma.business.findUnique({ where: { id: block.businessId }, select: { ownerId: true } });
    if (!business || business.ownerId !== vendorId) return res.status(403).json({ error: 'No tienes permiso' });

    await prisma.availabilityBlock.delete({ where: { id: blockId } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar bloque de disponibilidad' });
  }
};
