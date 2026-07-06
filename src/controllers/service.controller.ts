import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import { cacheGet, cacheSet, cacheKey, TTL, invalidateServices } from '../lib/cache';
import { runAsync } from '../lib/asyncTask';
import { verifyToken } from '../utils/jwt.util';

const VALID_CATEGORIES = [
  'BARBERIA','SPA','SALON_BELLEZA','TIENDA_CELULARES','VETERINARIA','REPOSTERIA',
  'ODONTOLOGIA','GIMNASIO','TATUAJES','PSICOLOGO','NUTRICIONISTA','PELUQUERIA_CANINA',
  'FISIOTERAPIA','MICROPIGMENTACION','CLASES_PARTICULARES','LIMPIEZA_HOGAR','MAQUILLAJE',
  'DJ','DECORACION_EVENTOS','CATERING','GASFITERIA','CARPINTERIA','JARDINERIA',
  'ELECTRICIDAD','DEPILACION','MASAJES_DOMICILIO','NAIL_ART','FLORES','TEJIDOS_CROCHET','OTRO',
];

// ============================================
// 1. CREAR SERVICIO
// ============================================
export const createService = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const rawBody = req.body as {
      businessId: string; name: string; description?: string;
      price: number; duration?: number; category: string;
    };
    const businessId  = rawBody.businessId?.trim();
    const name        = rawBody.name?.trim();
    const description = rawBody.description?.trim() || undefined;
    const price       = rawBody.price;
    const duration    = rawBody.duration;
    const category    = rawBody.category?.trim();

    if (!businessId || !name || !price || !category) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: businessId, name, price, category' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'El nombre del servicio no puede superar 100 caracteres' });
    }

    if (description && description.length > 500) {
      return res.status(400).json({ error: 'La descripción no puede superar 500 caracteres' });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Categoría de servicio no válida' });
    }

    const parsedPrice = parseFloat(String(price));
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor a 0' });
    }
    if (parsedPrice > 10000) {
      return res.status(400).json({ error: 'El precio no puede superar S/ 10,000' });
    }

    if (duration !== undefined && duration !== null) {
      const parsedDuration = parseInt(String(duration));
      if (isNaN(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
        return res.status(400).json({ error: 'La duración debe estar entre 1 y 1440 minutos' });
      }
    }

    // Verificar que el negocio existe y pertenece al usuario
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    if (business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para agregar servicios a este negocio' });
    }

    // Verificar límite según plan efectivo (planGuard lo adjunta respetando endDate)
    if ((req as any).userRole !== 'ADMIN') {
      const plan  = (req as any).effectivePlan ?? 'FREE';
      const limit = (req as any).maxServices   ?? 5;

      if (limit !== Infinity) {
        const currentCount = await prisma.service.count({ where: { businessId, isActive: true } });
        if (currentCount >= limit) {
          return res.status(403).json({
            error: `Tu plan ${plan} solo permite hasta ${limit} servicio${limit !== 1 ? 's' : ''} por negocio. Actualiza tu plan para agregar más.`
          });
        }
      }
    }

    const service = await prisma.service.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(String(price)),
        duration: duration ? parseInt(String(duration)) : null,
        category,
        businessId
      }
    });

    invalidateServices(businessId);
    res.status(201).json({
      success: true,
      message: 'Servicio creado exitosamente',
      service
    });

  } catch (error: any) {
    console.error('Error al crear servicio:', error);
    res.status(500).json({ error: 'Error al crear servicio' });
  }
};

// ============================================
// 2. LISTAR SERVICIOS DE UN NEGOCIO
// ============================================
export const getServicesByBusiness = async (req: Request, res: Response) => {
  try {
    const businessId = req.params.businessId as string;

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Endpoint público, pero si el dueño del negocio (o un admin) llama autenticado,
    // también le mostramos los servicios inactivos — si no, un servicio desactivado
    // desde el dashboard desaparecería sin forma de volver a activarlo.
    let isOwner = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken(authHeader.split(' ')[1]) as any;
        isOwner = decoded.userId === business.ownerId || decoded.role === 'ADMIN';
      } catch {
        // Token ausente/inválido: se trata como visitante público.
      }
    }

    const svcCacheKey = cacheKey.services(businessId);
    if (!isOwner) {
      const cached = cacheGet<object>(svcCacheKey);
      if (cached) return res.json(cached);
    }

    const services = await prisma.service.findMany({
      where: isOwner ? { businessId } : { businessId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    const payload = { success: true, count: services.length, services };
    if (!isOwner) cacheSet(svcCacheKey, payload, TTL.SERVICES);
    res.json(payload);

  } catch (error: any) {
    console.error('Error al listar servicios:', error);
    res.status(500).json({ error: 'Error al listar servicios' });
  }
};

// ============================================
// 3. OBTENER UN SERVICIO POR ID
// ============================================
export const getServiceById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            city: true,
            phone: true,
            category: true
          }
        }
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    res.json({ success: true, service });

  } catch (error: any) {
    console.error('Error al obtener servicio:', error);
    res.status(500).json({ error: 'Error al obtener servicio' });
  }
};

// ============================================
// 4. ACTUALIZAR SERVICIO
// ============================================
export const updateService = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;
    const { name, description, price, duration, category, isActive } = req.body as {
      name?: string;
      description?: string;
      price?: number;
      duration?: number;
      category?: string;
      isActive?: boolean;
    };

    const service = await prisma.service.findUnique({
      where: { id },
      include: { business: true }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para actualizar este servicio' });
    }

    let parsedPrice: number | undefined;
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'El nombre del servicio no puede estar vacío' });
      if (name.length > 100) return res.status(400).json({ error: 'El nombre no puede superar los 100 caracteres' });
    }
    if (description !== undefined && description !== null && description.length > 500) {
      return res.status(400).json({ error: 'La descripción no puede superar los 500 caracteres' });
    }
    if (price !== undefined) {
      parsedPrice = parseFloat(String(price));
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ error: 'El precio debe ser mayor a 0' });
      }
    }

    const updatedService = await prisma.service.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        description: description !== undefined ? description : undefined,
        price: parsedPrice,
        duration: duration ? parseInt(String(duration)) : undefined,
        category: category || undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    invalidateServices(updatedService.businessId);
    res.json({
      success: true,
      message: 'Servicio actualizado exitosamente',
      service: updatedService
    });

  } catch (error: any) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
};

// ============================================
// 5. ELIMINAR SERVICIO (Soft Delete)
// ============================================
export const deleteService = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId;

    const service = await prisma.service.findUnique({
      where: { id },
      include: { business: true }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este servicio' });
    }

    await prisma.service.update({
      where: { id },
      data: { isActive: false }
    });

    invalidateServices(service.businessId);
    res.json({
      success: true,
      message: 'Servicio eliminado exitosamente'
    });

  } catch (error: any) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ error: 'Error al eliminar servicio' });
  }
};

// ============================================
// 6. SUBIR FOTO DE SERVICIO
// ============================================
export const uploadServicePhoto = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).userId as string;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) return res.status(400).json({ error: 'No se recibió archivo' });

    const service = await prisma.service.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (service.business.ownerId !== userId && (req as any).userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso' });
    }

    // Eliminar foto anterior de Cloudinary si existe
    if (service.photo && service.photo.includes('res.cloudinary.com')) {
      const oldPublicId = extractPublicId(service.photo);
      if (oldPublicId) runAsync('delete-cloudinary', () => deleteFromCloudinary(oldPublicId));
    }

    const { url } = await uploadToCloudinary(file.buffer);
    const updated = await prisma.service.update({
      where: { id },
      data: { photo: url },
    });

    invalidateServices(service.businessId);
    res.json({ success: true, photo: url, service: updated });
  } catch (error: any) {
    console.error('Error al subir foto de servicio:', error);
    res.status(500).json({ error: 'Error al subir foto' });
  }
};
