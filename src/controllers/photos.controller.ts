import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import { runAsync } from '../lib/asyncTask';

// POST /api/businesses/:id/photos — vendor owner only
export const uploadPhoto = async (req: Request, res: Response) => {
  try {
    const id     = req.params.id as string;
    const userId = (req as any).userId as string;
    const caption = req.body.caption as string | undefined;

    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    const count = await prisma.businessPhoto.count({ where: { businessId: id } });
    if (count >= 8) return res.status(400).json({ error: 'Máximo 8 fotos por negocio' });

    const { url } = await uploadToCloudinary(req.file.buffer);

    const photo = await prisma.businessPhoto.create({
      data: { businessId: id, url, caption, order: count },
    });

    res.status(201).json({ success: true, photo });
  } catch (err: any) {
    console.error('Error al subir foto:', err);
    res.status(500).json({ error: 'Error al subir foto' });
  }
};

// GET /api/businesses/:id/photos — público
export const getPhotos = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const photos = await prisma.businessPhoto.findMany({
      where: { businessId: id },
      orderBy: { order: 'asc' },
    });
    res.json({ success: true, photos });
  } catch {
    res.status(500).json({ error: 'Error al obtener fotos' });
  }
};

// DELETE /api/businesses/:id/photos/:photoId — vendor owner only
export const deletePhoto = async (req: Request, res: Response) => {
  try {
    const id      = req.params.id as string;
    const photoId = req.params.photoId as string;
    const userId  = (req as any).userId as string;

    const photo = await prisma.businessPhoto.findUnique({ where: { id: photoId } });
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    if (photo.businessId !== id) return res.status(400).json({ error: 'Foto no pertenece a este negocio' });

    const business = await prisma.business.findUnique({ where: { id } });
    if (!business || business.ownerId !== userId) return res.status(403).json({ error: 'No tienes permiso' });

    // Eliminar de Cloudinary si la URL es de Cloudinary
    if (photo.url.includes('res.cloudinary.com')) {
      const publicId = extractPublicId(photo.url);
      if (publicId) runAsync('delete-cloudinary', () => deleteFromCloudinary(publicId));
    }

    await prisma.businessPhoto.delete({ where: { id: photoId } });
    res.json({ success: true, message: 'Foto eliminada' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
};
