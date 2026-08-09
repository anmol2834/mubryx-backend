import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all saved addresses for a customer.
   */
  async getAddresses(customerId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  /**
   * Get default address for a customer.
   */
  async getDefaultAddress(customerId: string) {
    const defaultAddress = await this.prisma.customerAddress.findFirst({
      where: { customerId, isDefault: true },
    });
    if (defaultAddress) return defaultAddress;

    // Fallback to the latest saved address
    return this.prisma.customerAddress.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a new address for a customer.
   */
  async createAddress(customerId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingForTag = await tx.customerAddress.findFirst({
        where: { customerId, label: dto.label },
      });

      const existingCount = await tx.customerAddress.count({
        where: { customerId },
      });

      const shouldBeDefault = dto.isDefault || existingCount === 0 || existingForTag?.isDefault || false;

      if (shouldBeDefault) {
        // Clear previous default
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      if (existingForTag) {
        // Replace existing address for this label slot!
        return tx.customerAddress.update({
          where: { id: existingForTag.id },
          data: {
            completeAddress: dto.completeAddress,
            landmark: dto.landmark,
            city: dto.city ?? null,
            state: dto.state ?? null,
            postalCode: dto.postalCode ?? null,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
            isDefault: shouldBeDefault,
          },
        });
      }

      return tx.customerAddress.create({
        data: {
          customerId,
          label: dto.label,
          completeAddress: dto.completeAddress,
          landmark: dto.landmark,
          city: dto.city ?? null,
          state: dto.state ?? null,
          postalCode: dto.postalCode ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  /**
   * Update an existing customer address.
   */
  async updateAddress(customerId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.prisma.customerAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          label: dto.label ?? address.label,
          completeAddress: dto.completeAddress ?? address.completeAddress,
          landmark: dto.landmark !== undefined ? dto.landmark : address.landmark,
          city: dto.city ?? address.city,
          state: dto.state ?? address.state,
          postalCode: dto.postalCode !== undefined ? dto.postalCode : address.postalCode,
          latitude: dto.latitude !== undefined ? dto.latitude : address.latitude,
          longitude: dto.longitude !== undefined ? dto.longitude : address.longitude,
          isDefault: dto.isDefault !== undefined ? dto.isDefault : address.isDefault,
        },
      });
    });
  }

  /**
   * Delete an address.
   */
  async deleteAddress(customerId: string, addressId: string) {
    const address = await this.prisma.customerAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({
        where: { id: addressId },
      });

      if (address.isDefault) {
        // Assign default to next available address
        const nextAddress = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        });
        if (nextAddress) {
          await tx.customerAddress.update({
            where: { id: nextAddress.id },
            data: { isDefault: true },
          });
        }
      }

      return { success: true };
    });
  }

  /**
   * Explicitly set an address as default.
   */
  async setDefaultAddress(customerId: string, addressId: string) {
    const address = await this.prisma.customerAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });

      return tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });
  }
}
