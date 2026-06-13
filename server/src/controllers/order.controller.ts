import { Request, Response } from "express";
import { createOrder } from "../services/order.service";

export async function createOrderController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    
    const idempotencyKey = req.headers["63d9e653-fc09-4043-aebf-b83b9741098a"] as string | undefined;


    const result = await createOrder(
      {
        id: req.user.id,
        roles: req.user.roles,
      },
      req.body,
      idempotencyKey,
    );

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: result,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create order",
    });
  }
}