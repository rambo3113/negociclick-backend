import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Valida req.body
export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field:   String(e.path.join('.')),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Datos inválidos', errors });
    }
    req.body = result.data;
    next();
  };
}

// Valida req.query (búsqueda, filtros, paginación)
export function validateQuery(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field:   String(e.path.join('.')),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Parámetros de búsqueda inválidos', errors });
    }
    Object.assign(req.query, result.data);
    next();
  };
}
