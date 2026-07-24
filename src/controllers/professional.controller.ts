import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import { runAsync } from '../lib/asyncTask';

const SPECIALTY_OPTIONS = ['corte', 'barba', 'tintura', 'tratamientos', 'pedicura', 'manicura'];

function validateSpecialties(specialties: unknown): specialties is string[] {
  return Array.isArray(specialties) && specialties.every(s => SPECIALTY_OPTIONS.includes(s));
}

async function assertOwner(businessId: string, userId: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
  if (!business) return { ok: false as const, status: 404, error: 'Negocio no encontrado' };
  if (business.ownerId !== userId) return { ok: false as const, status: 403, error: 'No tienes permiso' };
  return { ok: true as const };
}

// ============================================
// 1. CREAR PROFESIONAL
// POST /api/professionals/:businessId/create
// ============================================
export const createProfessional = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.businessId as string;
    const vendorId = (req as any).userId as string;
    const { name, email, phone, bio, specialties } = req.body as {
      name: string;
      email?: string;
      phone?: string;
      bio?: string;
      specialties?: string[];
    };

    if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    if (name.length > 100) return res.status(400).json({ error: 'El nombre no puede superar 100 caracteres' });
    if (bio && bio.length > 200) return res.status(400).json({ error: 'La bio no puede superar 200 caracteres' });
    if (specialties !== undefined && !validateSpecialties(specialties)) {
      return res.status(400).json({ error: `specialties debe ser un array con valores de: ${SPECIALTY_OPTIONS.join(', ')}` });
    }

    const auth = await assertOwner(businessId, vendorId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const professional = await prisma.professional.create({
      data: {
        businessId,
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        bio: bio?.trim() || null,
        specialties: specialties ?? [],
      },
    });

    res.status(201).json({ success: true, professional });
  } catch (error: any) {
    console.error('Error al crear profesional:', error);
    res.status(500).json({ error: 'Error al crear profesional' });
  }
};

// ============================================
// 2. ACTUALIZAR PROFESIONAL
// PUT /api/professionals/:businessId/:professionalId
// ============================================
export const updateProfessional = async (req: Request, res: Response) => {
  try {
    const { businessId, professionalId } = req.params as { businessId: string; professionalId: string };
    const vendorId = (req as any).userId as string;
    const { name, email, phone, bio, specialties, isActive } = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      bio?: string;
      specialties?: string[];
      isActive?: boolean;
    };

    if (name !== undefined && (!name.trim() || name.length > 100)) {
      return res.status(400).json({ error: 'Nombre inválido (1-100 caracteres)' });
    }
    if (bio !== undefined && bio !== null && bio.length > 200) {
      return res.status(400).json({ error: 'La bio no puede superar 200 caracteres' });
    }
    if (specialties !== undefined && !validateSpecialties(specialties)) {
      return res.status(400).json({ error: `specialties debe ser un array con valores de: ${SPECIALTY_OPTIONS.join(', ')}` });
    }

    const auth = await assertOwner(businessId, vendorId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const existing = await prisma.professional.findUnique({ where: { id: professionalId } });
    if (!existing || existing.businessId !== businessId) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    const professional = await prisma.professional.update({
      where: { id: professionalId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(bio !== undefined ? { bio: bio?.trim() || null } : {}),
        ...(specialties !== undefined ? { specialties } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    res.json({ success: true, professional });
  } catch (error: any) {
    console.error('Error al actualizar profesional:', error);
    res.status(500).json({ error: 'Error al actualizar profesional' });
  }
};

// ============================================
// 3. SUBIR FOTO DE PROFESIONAL
// POST /api/professionals/:businessId/:professionalId/photo
// ============================================
export const uploadProfessionalPhoto = async (req: Request, res: Response) => {
  try {
    const { businessId, professionalId } = req.params as { businessId: string; professionalId: string };
    const vendorId = (req as any).userId as string;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const auth = await assertOwner(businessId, vendorId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const professional = await prisma.professional.findUnique({ where: { id: professionalId } });
    if (!professional || professional.businessId !== businessId) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    if (professional.photo && professional.photo.includes('res.cloudinary.com')) {
      const oldPublicId = extractPublicId(professional.photo);
      if (oldPublicId) runAsync('delete-cloudinary-professional', () => deleteFromCloudinary(oldPublicId));
    }

    const { url } = await uploadToCloudinary(file.buffer);
    const updated = await prisma.professional.update({
      where: { id: professionalId },
      data: { photo: url },
    });

    res.json({ success: true, professional: updated });
  } catch (error: any) {
    console.error('Error al subir foto de profesional:', error);
    res.status(500).json({ error: 'Error al subir foto' });
  }
};

// ============================================
// 4. ELIMINAR (SOFT DELETE) PROFESIONAL
// DELETE /api/professionals/:businessId/:professionalId
// ============================================
export const deleteProfessional = async (req: Request, res: Response) => {
  try {
    const { businessId, professionalId } = req.params as { businessId: string; professionalId: string };
    const vendorId = (req as any).userId as string;

    const auth = await assertOwner(businessId, vendorId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const existing = await prisma.professional.findUnique({ where: { id: professionalId } });
    if (!existing || existing.businessId !== businessId) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    await prisma.professional.update({ where: { id: professionalId }, data: { isActive: false } });
    res.json({ success: true, message: 'Profesional desactivado' });
  } catch (error: any) {
    console.error('Error al eliminar profesional:', error);
    res.status(500).json({ error: 'Error al eliminar profesional' });
  }
};

// ============================================
// 5. LISTAR PROFESIONALES ACTIVOS DE UN NEGOCIO (público)
// GET /api/professionals/:businessId
// ============================================
export const getProfessionals = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.businessId as string;

    const professionals = await prisma.professional.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, professionals });
  } catch (error: any) {
    console.error('Error al obtener profesionales:', error);
    res.status(500).json({ error: 'Error al obtener profesionales' });
  }
};

// ============================================
// 6. HORARIOS DE UN PROFESIONAL (público)
// GET /api/professionals/schedules/:professionalId
// ============================================
export const getProfessionalSchedules = async (req: Request, res: Response) => {
  try {
    const professionalId = req.params.professionalId as string;

    const schedules = await prisma.professionalSchedule.findMany({
      where: { professionalId },
      orderBy: { dayOfWeek: 'asc' },
    });

    res.json({ success: true, schedules });
  } catch (error: any) {
    console.error('Error al obtener horarios:', error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
};

// ============================================
// 7. ACTUALIZAR HORARIO DE UN DÍA (upsert)
// PUT /api/professionals/schedule/:businessId/:professionalId
// ============================================
export const updateProfessionalSchedule = async (req: Request, res: Response) => {
  try {
    const { businessId, professionalId } = req.params as { businessId: string; professionalId: string };
    const vendorId = (req as any).userId as string;
    const { dayOfWeek, startTime, endTime, isClosed } = req.body as {
      dayOfWeek: number;
      startTime?: string;
      endTime?: string;
      isClosed?: boolean;
    };

    if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'dayOfWeek debe ser un número entre 0 y 6' });
    }
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (startTime !== undefined && !timeRe.test(startTime)) {
      return res.status(400).json({ error: 'startTime debe tener formato HH:MM' });
    }
    if (endTime !== undefined && !timeRe.test(endTime)) {
      return res.status(400).json({ error: 'endTime debe tener formato HH:MM' });
    }
    if (startTime && endTime && startTime >= endTime) {
      return res.status(400).json({ error: 'startTime debe ser anterior a endTime' });
    }

    const auth = await assertOwner(businessId, vendorId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const professional = await prisma.professional.findUnique({ where: { id: professionalId } });
    if (!professional || professional.businessId !== businessId) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    const schedule = await prisma.professionalSchedule.upsert({
      where: { professionalId_dayOfWeek: { professionalId, dayOfWeek } },
      create: {
        professionalId,
        dayOfWeek,
        startTime: startTime || '09:00',
        endTime: endTime || '18:00',
        isClosed: isClosed ?? false,
      },
      update: {
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
        ...(isClosed !== undefined ? { isClosed } : {}),
      },
    });

    res.json({ success: true, schedule });
  } catch (error: any) {
    console.error('Error al actualizar horario:', error);
    res.status(500).json({ error: 'Error al actualizar horario' });
  }
};
