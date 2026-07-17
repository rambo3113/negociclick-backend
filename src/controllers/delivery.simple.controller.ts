import { Request, Response } from 'express';
import { prisma } from '../config/database';

// PUBLIC: Get delivery methods available for a business
export const getDeliveryMethods = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;

    // For now: ALL businesses have PICKUP available
    // DELIVERY is available to PRO/PREMIUM plans (check business.plan)
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { plan: true },
    });

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const methods: any = {
      pickup: {
        enabled: true,
        cost: 0,
      },
    };

    // Delivery only for PRO/PREMIUM
    if (business.plan === 'PRO' || business.plan === 'PREMIUM') {
      methods.delivery = {
        enabled: true,
        zones: [
          { id: 'miraflores', name: 'Miraflores', cost: 15 },
          { id: 'surco', name: 'Surco', cost: 18 },
          { id: 'la-molina', name: 'La Molina', cost: 20 },
          { id: 'san-isidro', name: 'San Isidro', cost: 15 },
          { id: 'breña', name: 'Breña', cost: 25 },
        ],
      };
    }

    return res.json({ success: true, methods });
  } catch (error) {
    console.error('Error getDeliveryMethods:', error);
    return res.status(500).json({ error: 'Error al obtener métodos de delivery' });
  }
};
