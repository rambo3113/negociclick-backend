import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { invalidateBusiness } from '../lib/cache';

// POST /businesses/:id/subcategories
export const createSubcategory = async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.id);
    const userId = (req as any).userId as string;
    const { name, description, category, position } = req.body as {
      name?: string; description?: string; category?: string; position?: number;
    };

    if (!name?.trim() || !category?.trim()) {
      return res.status(400).json({ error: 'name y category son requeridos' });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre no puede superar 100 caracteres' });
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const sub = await (prisma as any).subcategory.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        category: category.trim(),
        position: position ?? 0,
        businessId,
      },
    });

    invalidateBusiness(businessId);
    res.status(201).json({ success: true, subcategory: sub });
  } catch (err) {
    console.error('[subcategory] create error:', err);
    res.status(500).json({ error: 'Error al crear subcategoría' });
  }
};

// GET /businesses/:id/subcategories
export const getSubcategories = async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.id);
    const subs = await (prisma as any).subcategory.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { services: true } } },
    });
    res.json({ success: true, subcategories: subs });
  } catch (err) {
    console.error('[subcategory] list error:', err);
    res.status(500).json({ error: 'Error al listar subcategorías' });
  }
};

// PUT /businesses/:id/subcategories/:subId
export const updateSubcategory = async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.id);
    const subId = String(req.params.subId);
    const userId = (req as any).userId as string;
    const { name, description, position } = req.body as {
      name?: string; description?: string; position?: number;
    };

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const sub = await (prisma as any).subcategory.update({
      where: { id: subId },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(position !== undefined ? { position } : {}),
      },
    });

    invalidateBusiness(businessId);
    res.json({ success: true, subcategory: sub });
  } catch (err) {
    console.error('[subcategory] update error:', err);
    res.status(500).json({ error: 'Error al actualizar subcategoría' });
  }
};

// DELETE /businesses/:id/subcategories/:subId
export const deleteSubcategory = async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.id);
    const subId = String(req.params.subId);
    const userId = (req as any).userId as string;

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const svcCount = await prisma.service.count({ where: { subcategoryId: subId } });
    if (svcCount > 0) {
      return res.status(400).json({
        error: `Esta subcategoría tiene ${svcCount} servicio(s). Desvincula o elimina los servicios primero.`,
      });
    }

    await (prisma as any).subcategory.delete({ where: { id: subId } });
    invalidateBusiness(businessId);
    res.json({ success: true });
  } catch (err) {
    console.error('[subcategory] delete error:', err);
    res.status(500).json({ error: 'Error al eliminar subcategoría' });
  }
};
