import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch complete unified catalog (categories + active services)
   */
  async getCatalog() {
    const [categories, services] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: { displayOrder: 'asc' },
      }),
      this.prisma.service.findMany({
        where: { isActive: true },
        orderBy: { title: 'asc' },
      }),
    ]);

    return {
      categories,
      services,
    };
  }

  /**
   * Fetch all categories
   */
  async getCategories() {
    return this.prisma.category.findMany({
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Fetch single category by ID or slug
   */
  async getCategoryByIdOrSlug(idOrSlug: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        Service: {
          where: { isActive: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category '${idOrSlug}' not found`);
    }

    return category;
  }

  /**
   * Fetch active services with optional filters
   */
  async getServices(params: { categoryId?: string; search?: string; isPopular?: boolean }) {
    const where: any = { isActive: true };

    if (params.categoryId) {
      where.OR = [
        { categoryId: params.categoryId },
        { Category: { slug: params.categoryId } },
      ];
    }

    if (params.isPopular) {
      where.isPopular = true;
    }

    if (params.search) {
      where.title = { contains: params.search, mode: 'insensitive' };
    }

    return this.prisma.service.findMany({
      where,
      orderBy: { title: 'asc' },
      include: {
        Category: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
  }

  /**
   * Fetch single service details by ID
   */
  async getServiceById(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        Category: true,
      },
    });

    if (!service) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    return service;
  }
}
