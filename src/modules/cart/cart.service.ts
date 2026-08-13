import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Formats a Cart database record into a canonical response structure.
   */
  private formatCartResponse(cart: any) {
    const items = (cart.items || []).map((item: any) => {
      const uPrice = item.unitPrice ?? item.service?.price ?? 0;
      const lTotal = item.lineTotal ?? (uPrice * item.quantity);
      return {
        id: item.id,
        cartId: item.cartId,
        serviceId: item.serviceId,
        quantity: item.quantity,
        unitPrice: uPrice,
        lineTotal: lTotal,
        specialNotes: item.specialNotes ?? null,
        pricing: {
          listPrice: item.service?.price ?? uPrice,
          unitPrice: uPrice,
          lineTotal: lTotal,
        },
        service: item.service
          ? {
              id: item.service.id,
              categoryId: item.service.categoryId,
              title: item.service.title,
              description: item.service.description,
              price: item.service.price,
              discountPrice: item.service.discountPrice ?? null,
              image: item.service.image ?? null,
              duration: item.service.duration ?? '45 mins',
            }
          : {
              id: item.serviceId,
              title: 'Service',
              description: '',
              price: uPrice,
            },
      };
    });

    const itemCount = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
    const subtotal = items.reduce((sum: number, item: any) => sum + item.lineTotal, 0);
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + tax;

    return {
      id: cart.id,
      cartId: cart.id,
      customerId: cart.customerId,
      status: cart.status,
      currency: cart.currency,
      version: cart.version,
      lastActivityAt: cart.lastActivityAt,
      items,
      itemCount,
      summary: {
        subtotal,
        discount: 0,
        taxableAmount: subtotal,
        tax,
        platformFee: 0,
        total,
      },
    };
  }

  /**
   * Internal helper to find or create the single ACTIVE cart for a customer.
   */
  async getOrCreateActiveCart(customerId: string) {
    if (!customerId) {
      throw new BadRequestException('Customer ID is required to access cart');
    }

    let cart = await this.prisma.cart.findFirst({
      where: { customerId, status: 'ACTIVE' },
      include: {
        items: {
          include: { service: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!cart) {
      try {
        cart = await this.prisma.cart.create({
          data: {
            customerId,
            status: 'ACTIVE',
            currency: 'INR',
            version: 1,
          },
          include: {
            items: {
              include: { service: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2003') {
          throw new UnauthorizedException('User account no longer exists or session is invalid');
        }
        throw err;
      }
    }

    return this.formatCartResponse(cart);
  }

  /**
   * Get current active cart for customer.
   */
  async getCart(customerId: string) {
    return this.getOrCreateActiveCart(customerId);
  }

  /**
   * Add item to active cart (Server authoritative pricing from PostgreSQL Service table).
   * Enforces Single-Category Cart Isolation: replaces previous category items if a new category is selected.
   */
  async addCartItem(customerId: string, dto: AddCartItemDto) {
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: {
        id: true,
        categoryId: true,
        price: true,
        discountPrice: true,
        isActive: true,
      },
    });

    if (!service || !service.isActive) {
      throw new NotFoundException('Service not available or does not exist');
    }

    const unitPrice = service.discountPrice ?? service.price;
    const qtyToAdd = dto.quantity ?? 1;

    return this.prisma.$transaction(async (tx) => {
      let cart = await tx.cart.findFirst({
        where: { customerId, status: 'ACTIVE' },
        select: { id: true },
      });

      if (!cart) {
        cart = await tx.cart.create({
          data: {
            customerId,
            status: 'ACTIVE',
            currency: 'INR',
            version: 1,
          },
          select: { id: true },
        });
      }

      // Strict Single-Category Cart Isolation:
      // Atomically delete ANY items in the active cart that do NOT belong to this service's category
      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
          service: {
            categoryId: { not: service.categoryId },
          },
        },
      });

      await tx.cartItem.upsert({
        where: {
          cartId_serviceId: {
            cartId: cart.id,
            serviceId: service.id,
          },
        },
        create: {
          cartId: cart.id,
          serviceId: service.id,
          quantity: qtyToAdd,
          unitPrice,
          lineTotal: unitPrice * qtyToAdd,
          specialNotes: dto.specialNotes,
        },
        update: {
          quantity: { increment: qtyToAdd },
          unitPrice,
          lineTotal: { increment: unitPrice * qtyToAdd },
          specialNotes: dto.specialNotes ?? undefined,
        },
      });

      await tx.cart.update({
        where: { id: cart.id },
        data: {
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: { service: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return this.formatCartResponse(updatedCart);
    });
  }

  /**
   * Update item quantity in active cart.
   * Resilient: accepts either cartItem.id OR serviceId.
   */
  async updateCartItem(customerId: string, cartItemIdOrServiceId: string, dto: UpdateCartItemDto) {
    const activeCart = await this.getOrCreateActiveCart(customerId);

    const item = (activeCart.items || []).find(
      (i: any) => i.id === cartItemIdOrServiceId || i.serviceId === cartItemIdOrServiceId,
    );

    if (!item) {
      throw new NotFoundException('Cart item not found in active cart');
    }

    if (dto.expectedVersion !== undefined && activeCart.version !== dto.expectedVersion) {
      throw new ConflictException('Cart version conflict. Please retry.');
    }

    const unitPrice = item.service?.discountPrice ?? item.service?.price ?? item.unitPrice;
    const newQty = dto.quantity;
    const lineTotal = unitPrice * newQty;

    return this.prisma.$transaction(async (tx) => {
      await tx.cartItem.updateMany({
        where: { id: item.id },
        data: {
          quantity: newQty,
          unitPrice,
          lineTotal,
        },
      });

      await tx.cart.update({
        where: { id: activeCart.id },
        data: {
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      const updatedCart = await tx.cart.findUnique({
        where: { id: activeCart.id },
        include: {
          items: {
            include: { service: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return this.formatCartResponse(updatedCart);
    });
  }

  /**
   * Remove item from active cart.
   * Resilient: accepts either cartItem.id OR serviceId.
   * Idempotent & Race-Condition Safe: returns active cart formatted cleanly if item was already removed (200 OK).
   */
  async removeCartItem(customerId: string, cartItemIdOrServiceId: string) {
    const activeCart = await this.getOrCreateActiveCart(customerId);

    return this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({
        where: {
          cartId: activeCart.id,
          OR: [
            { id: cartItemIdOrServiceId },
            { serviceId: cartItemIdOrServiceId },
          ],
        },
      });

      await tx.cart.update({
        where: { id: activeCart.id },
        data: {
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      const updatedCart = await tx.cart.findUnique({
        where: { id: activeCart.id },
        include: {
          items: {
            include: { service: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return this.formatCartResponse(updatedCart);
    });
  }

  /**
   * Clear all items from customer's active cart.
   */
  async clearCart(customerId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, status: 'ACTIVE' },
    });

    if (!cart) {
      return this.getOrCreateActiveCart(customerId);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      await tx.cart.update({
        where: { id: cart.id },
        data: {
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: { service: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return this.formatCartResponse(updatedCart);
    });
  }

  /**
   * Merge guest cart selections into active customer cart upon login/signup.
   */
  async mergeGuestCart(customerId: string, dto: MergeCartDto) {
    if (!dto.items || dto.items.length === 0) {
      return this.getOrCreateActiveCart(customerId);
    }

    for (const item of dto.items) {
      try {
        await this.addCartItem(customerId, {
          serviceId: item.serviceId,
          quantity: item.quantity ?? 1,
          specialNotes: item.specialNotes,
        });
      } catch {
        // Skip individual invalid items gracefully during merge
      }
    }

    return this.getOrCreateActiveCart(customerId);
  }
}
